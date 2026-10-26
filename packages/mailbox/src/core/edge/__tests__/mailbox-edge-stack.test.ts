/// <reference types="jest" />

/**
 * MailboxEdgeStack template synthesis tests.
 *
 * Pins what the edge stack itself decides in its synthesized template: the root-stack tags on its
 * taggable resources, the parameter schema it exposes, the hosted-zone condition that gates the
 * certificate and its output, and the retention of the Lambda@Edge function and its version, which
 * CloudFront replicas keep referencing. The deployer worker that the stack hands its work to is tested
 * in its own file.
 */

import { Match, Template }                 from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer }   from 'aws-cdk-lib';
import * as t                              from 'typanion';

import { MailboxEdgeStack }                from '../mailbox-edge-stack';
import type { MailboxEdgeStackParameters } from '../mailbox-edge-stack';

function synthEdgeStack(): Template {
  const app   = new App();
  const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
    env:         { account: '123456789012', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return Template.fromStack(stack);
}

const HOST_PARAMETERS: Array<keyof MailboxEdgeStackParameters> = ['webmailHost', 'adminHost', 'cdnHost'];

const UNDECLARED_PARAMETERS = ['domainName', 'prefix'];

const SCHEMA_PARAMETERS: Array<keyof MailboxEdgeStackParameters> = [
  'hostedZoneId',
  'rootStack',
  'artifactBucket',
  'logGroupName',
  'jmapBlobDownloadKey',
  'jmapBlobDownloadS3VersionId',
  'jmapBlobDownloadRoleArn',
];

const isParameterTable = t.isRecord(t.isPartial({
  Type:           t.isOptional(t.isString()),
  Default:        t.isOptional(t.isString()),
  AllowedPattern: t.isOptional(t.isString()),
}));
const isHostParameter  = t.isPartial({
  Type:           t.isLiteral('String'),
  Default:        t.isLiteral(''),
  AllowedPattern: t.isString(),
});

function hostParameterOf(template: Template, name: keyof MailboxEdgeStackParameters): t.InferType<typeof isHostParameter> {
  const table: unknown   = template.toJSON().Parameters ?? {};
  const errors: string[] = [];

  if (!isParameterTable(table, { errors })) {
    throw new Error(`The template parameters are malformed: ${errors.join('; ')}`);
  }

  const parameter: unknown = table[name];
  if (!isHostParameter(parameter, { errors })) {
    throw new Error(`Parameter ${name} is not an empty-by-default String with an AllowedPattern: ${errors.join('; ')}`);
  }

  return parameter;
}

function onlyLogicalIdOf(template: Template, type: string): string {
  const logicalIds = Object.keys(template.findResources(type));
  if (logicalIds.length !== 1) {
    throw new Error(`Expected exactly one ${type}, found ${logicalIds.length}`);
  }
  return logicalIds[0];
}

describe('MailboxEdgeStack template synthesis', () => {
  describe('tag contract', () => {
    it.each(['AWS::Lambda::Function', 'AWS::CertificateManager::Certificate'])('tags every %s with the root stack name and id parameters', (type) => {
      synthEdgeStack().allResourcesProperties(type, {
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:root-stack', Value: { Ref: 'rootStack' } },
          { Key: 'serverless-inbox:root-stack-id', Value: { Ref: 'rootStackId' } },
        ]),
      });
    });

    it('requires the rootStackId parameter', () => {
      synthEdgeStack().hasParameter('rootStackId', { Type: 'String', Default: Match.absent() });
    });
  });

  describe('construct quality', () => {
    it('synthesizes one Lambda@Edge function and one edge certificate', () => {
      const template = synthEdgeStack();

      template.resourceCountIs('AWS::Lambda::Function', 1);
      template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    });

    it.each(SCHEMA_PARAMETERS)('exposes the %s parameter the root stack passes in', (name) => {
      synthEdgeStack().hasParameter(name, { Type: 'String' });
    });

    describe('host parameters', () => {
      it.each(HOST_PARAMETERS)('declares %s as an empty-by-default parameter that accepts only an empty value or a DNS name', (name) => {
        const parameter = hostParameterOf(synthEdgeStack(), name);
        const pattern   = new RegExp(parameter.AllowedPattern);

        expect(pattern.test('')).toBe(true);
        expect(pattern.test('inbox.mail.example.com')).toBe(true);
        expect(pattern.test('a..b')).toBe(false);
        expect(pattern.test('-x.example.com')).toBe(false);
      });

      it.each(UNDECLARED_PARAMETERS)('does not declare %s', (name) => {
        expect(synthEdgeStack().toJSON().Parameters).not.toHaveProperty(name);
      });

      it('names the certificate after the webmail host and adds the admin and cdn hosts in that order', () => {
        synthEdgeStack().hasResourceProperties('AWS::CertificateManager::Certificate', {
          DomainName:              { Ref: 'webmailHost' },
          SubjectAlternativeNames: [{ Ref: 'adminHost' }, { Ref: 'cdnHost' }],
        });
      });
    });

    it('names the Lambda@Edge function, its version and the version output jmap-blob-download', () => {
      const template = synthEdgeStack();

      expect(onlyLogicalIdOf(template, 'AWS::Lambda::Function')).toMatch(/^edgejmapblobdownload[0-9A-F]{8}$/);
      expect(onlyLogicalIdOf(template, 'AWS::Lambda::Version')).toMatch(/^edgejmapblobdownloadCurrentVersion[0-9A-F]{8}/);
      template.hasOutput('jmapBlobDownloadVersionArn', {});
    });

    it('resolves the jmap-blob-download LoggingConfig.LogGroup to a Ref on the logGroupName parameter', () => {
      synthEdgeStack().hasResourceProperties('AWS::Lambda::Function', {
        Handler:       'index.handler',
        LoggingConfig: Match.objectLike({ LogGroup: { Ref: 'logGroupName' } }),
      });
    });
  });

  describe('hosted zone', () => {
    it('has a hosted zone when both the hosted zone id and name are non-empty', () => {
      synthEdgeStack().hasCondition('hasHostedZone', {
        'Fn::And': [
          { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'hostedZoneId' }, ''] }] },
          { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'hostedZoneName' }, ''] }] },
        ],
      });
    });

    it('creates the edge certificate only when a hosted zone is present', () => {
      synthEdgeStack().hasResource('AWS::CertificateManager::Certificate', { Condition: 'hasHostedZone' });
    });

    it('outputs the certificate ARN when a hosted zone is present and an empty string otherwise', () => {
      const template      = synthEdgeStack();
      const certificateId = onlyLogicalIdOf(template, 'AWS::CertificateManager::Certificate');

      template.hasOutput('edgeCertificateArn', { Value: { 'Fn::If': ['hasHostedZone', { Ref: certificateId }, ''] } });
    });
  });

  describe('retention', () => {
    it.each(['AWS::Lambda::Function', 'AWS::Lambda::Version'])('retains the %s on update and delete', (type) => {
      synthEdgeStack().allResources(type, { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
    });
  });
});
