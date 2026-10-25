/**
 * MailboxEdgeStack template synthesis tests.
 *
 * Pins what the edge stack itself decides in its synthesized template: the root-stack tag contract on
 * its taggable resources, the parameter schema it exposes, and the Lambda@Edge function's identity,
 * version and log group. The deployer worker that the stack hands its work to is tested in its own file.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import * as t                            from 'typanion';

import {
  CloudFormationResource,
  isResourceOfType,
  readTags,
} from '../../../__tests__/iam-test-helpers';
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

function resourcesOfTemplate(template: Template): Record<string, CloudFormationResource> {
  const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
  if (!resources) {
    throw new Error('No resources found in template');
  }
  return resources;
}

describe('MailboxEdgeStack template synthesis', () => {
  describe('tag contract', () => {
    it('tags every taggable edge resource with the rootStack parameter', () => {
      const resources = resourcesOfTemplate(synthEdgeStack());

      let taggedResourceCount = 0;
      for (const resource of Object.values(resources)) {
        if (!isResourceOfType(resource, 'AWS::Lambda::Function') && !isResourceOfType(resource, 'AWS::IAM::Role') && !isResourceOfType(resource, 'AWS::CertificateManager::Certificate')) {
          continue;
        }

        const tags = readTags(resource);
        if (tags === undefined) {continue;}
        taggedResourceCount++;

        const rootStackTag = tags.find((tag) => tag.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag?.Value).toEqual({ Ref: 'rootStack' });
      }

      expect(taggedResourceCount).toBeGreaterThan(0);
    });

    it('declares a mandatory rootStackId parameter and tags its resources with it', () => {
      const template   = synthEdgeStack();
      const parameters = template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>;
      expect(parameters.rootStackId).toEqual(expect.objectContaining({ Type: 'String' }));
      expect(parameters.rootStackId.Default).toBeUndefined();

      const tagged = Object.values(resourcesOfTemplate(template)).filter(
        (resource) => (isResourceOfType(resource, 'AWS::Lambda::Function') || isResourceOfType(resource, 'AWS::IAM::Role')) && readTags(resource) !== undefined,
      );
      expect(tagged.length).toBeGreaterThan(0);
      for (const resource of tagged) {
        const tag = readTags(resource)?.find((candidate) => candidate.Key === 'serverless-inbox:root-stack-id');
        expect(tag?.Value).toEqual({ Ref: 'rootStackId' });
      }
    });

    it('never tags an edge Lambda with AWS::StackName in place of the rootStack parameter', () => {
      for (const resource of Object.values(resourcesOfTemplate(synthEdgeStack()))) {
        if (!isResourceOfType(resource, 'AWS::Lambda::Function')) {continue;}

        const rootStackTag = readTags(resource)?.find((tag) => tag.Key === 'serverless-inbox:root-stack');
        if (rootStackTag) {
          expect(rootStackTag.Value).toEqual({ Ref: 'rootStack' });
        }
      }
    });
  });

  describe('construct quality', () => {
    it('synthesizes the Lambda, the certificate and more than three resources', () => {
      const resources       = Object.values(resourcesOfTemplate(synthEdgeStack()));

      expect(resources.length).toBeGreaterThan(3);
      expect(resources.some((resource) => isResourceOfType(resource, 'AWS::Lambda::Function'))).toBe(true);
      expect(resources.some((resource) => isResourceOfType(resource, 'AWS::CertificateManager::Certificate'))).toBe(true);
    });

    it('exposes the parameter schema the root stack passes in', () => {
      const parameters: unknown = synthEdgeStack().toJSON().Parameters ?? {};

      expect(parameters).toHaveProperty('hostedZoneId');
      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('artifactBucket');
      expect(parameters).toHaveProperty('logGroupName');
      expect(parameters).toHaveProperty('jmapBlobDownloadKey');
      expect(parameters).toHaveProperty('jmapBlobDownloadS3VersionId');
      expect(parameters).toHaveProperty('jmapBlobDownloadRoleArn');
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
      const template         = synthEdgeStack().toJSON();
      const resources        = template.Resources as Record<string, CloudFormationResource>;
      const logicalIdsOfType = (type: string): string[] =>
        Object.entries(resources).filter(([, resource]) => isResourceOfType(resource, type)).map(([logicalId]) => logicalId);

      expect(logicalIdsOfType('AWS::Lambda::Function')).toEqual([expect.stringMatching(/^edgejmapblobdownload[0-9A-F]{8}$/)]);
      expect(logicalIdsOfType('AWS::Lambda::Version')).toEqual([expect.stringMatching(/^edgejmapblobdownloadCurrentVersion[0-9A-F]{8}/)]);
      expect(template.Outputs).toHaveProperty('jmapBlobDownloadVersionArn');
    });

    it('resolves the jmap-blob-download LoggingConfig.LogGroup to a Ref on the logGroupName parameter', () => {
      const resources          = resourcesOfTemplate(synthEdgeStack());
      const jmapBlobDownloadFn = Object.values(resources).find(
        (resource) => isResourceOfType(resource, 'AWS::Lambda::Function') && resource.Properties?.Handler === 'index.handler',
      );

      expect(jmapBlobDownloadFn).toBeDefined();
      const loggingConfig = jmapBlobDownloadFn?.Properties?.LoggingConfig as { LogGroup?: unknown } | undefined;
      expect(loggingConfig?.LogGroup).toEqual({ Ref: 'logGroupName' });
    });
  });
});
