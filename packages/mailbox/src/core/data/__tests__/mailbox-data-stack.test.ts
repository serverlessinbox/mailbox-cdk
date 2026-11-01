/// <reference types="jest" />

/**
 * MailboxDataStack template synthesis tests.
 *
 * Pins what the data stack itself decides in its synthesized template: its four parameters, the
 * root-stack tags it stamps on every table and bucket, the fixed logical ids and ARN outputs that
 * the main stack imports, the production and development settings it hands the tables and the blob
 * store, and the KMS settings it passes on. What each table and bucket defines is pinned in its own
 * test file.
 */

import { DEVELOPMENT_CONTEXT_KEY }              from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { Key }                                  from 'aws-cdk-lib/aws-kms';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import * as t                                   from 'typanion';

import { resourcesOfType }                      from '../../../__tests__/template-resources';
import type { MailboxKmsConfig }                from '../../kms';
import { MailboxKmsMode }                       from '../../mailbox-kms-mode';
import { MailboxDataStack }                     from '../mailbox-data-stack';

const TABLE_LOGICAL_IDS = ['auditLogTable', 'changelogTable', 'configTable', 'itemTable', 'mailFeedbackTable', 'patTable'];

/** The properties of a DynamoDB table this file reads: its tags, point-in-time recovery and secondary indexes. */
const isDynamoTableProperties = t.isPartial({
  Tags:                             t.isArray(t.isPartial({ Key: t.isString() })),
  PointInTimeRecoverySpecification: t.isPartial({ PointInTimeRecoveryEnabled: t.isBoolean() }),
  GlobalSecondaryIndexes:           t.isOptional(t.isArray(t.isPartial({
    IndexName:  t.isString(),
    Projection: t.isPartial({ ProjectionType: t.isOptional(t.isString()) }),
  }))),
});

/** The DynamoDB table with the given logical id in the template. */
function tableNamed(template: Template, logicalId: string) {
  const table = resourcesOfType(template, 'AWS::DynamoDB::Table', isDynamoTableProperties).find((candidate) => candidate.logicalId === logicalId);
  if (!table) {
    throw new Error(`no DynamoDB table with logical id ${logicalId} in the template`);
  }
  return table;
}

/** The tags of a table except `Name`, which carries that table's own construct id. */
function baseTagsOf(table: ReturnType<typeof tableNamed>) {
  return table.properties.Tags.filter((tag) => tag.Key !== 'Name');
}

/** Development mode turns on auto-delete of the blob bucket, whose provider is an asset a bootstrapless stack cannot hold. */
function synthDataStack(options: { readonly development?: boolean; readonly kms?: MailboxKmsConfig } = {}): Template {
  const development = options.development ?? false;
  const stack       = new MailboxDataStack(new App({ context: { [DEVELOPMENT_CONTEXT_KEY]: development } }), 'TestMailboxData', {
    env: { account: '123456789012', region: 'us-west-2' },
    kms: options.kms,
    ...(development ? {} : { synthesizer: new BootstraplessSynthesizer() }),
  });
  return Template.fromStack(stack);
}

describe('MailboxDataStack template synthesis', () => {
  describe('parameters', () => {
    it('requires nameBase and rootStackId', () => {
      const template = synthDataStack();

      template.hasParameter('nameBase', { Type: 'String', Default: Match.absent() });
      template.hasParameter('rootStackId', { Type: 'String', Default: Match.absent() });
    });

    it('defaults rootStack to empty and deployerType to cfn, limited to cdk, cfn and marketplace', () => {
      const template = synthDataStack();

      template.hasParameter('rootStack', { Type: 'String', Default: '' });
      template.hasParameter('deployerType', { Type: 'String', Default: 'cfn', AllowedValues: ['cdk', 'cfn', 'marketplace'] });
    });
  });

  describe('tag contract', () => {
    it('tags every table with the root stack name and id parameters', () => {
      const template = synthDataStack();

      template.resourceCountIs('AWS::DynamoDB::Table', TABLE_LOGICAL_IDS.length);
      template.allResourcesProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:root-stack', Value: { Ref: 'rootStack' } },
          { Key: 'serverless-inbox:root-stack-id', Value: { Ref: 'rootStackId' } },
        ]),
      });
    });

    it('tags the blob bucket with the root stack name and id parameters', () => {
      const template = synthDataStack();

      template.resourceCountIs('AWS::S3::Bucket', 1);
      template.allResourcesProperties('AWS::S3::Bucket', {
        Tags: Match.arrayWith([
          { Key: 'serverless-inbox:root-stack', Value: { Ref: 'rootStack' } },
          { Key: 'serverless-inbox:root-stack-id', Value: { Ref: 'rootStackId' } },
        ]),
      });
    });
  });

  describe('logical ids and outputs', () => {
    it('fixes the logical id of every table, the blob bucket and its policy', () => {
      const template = synthDataStack();

      expect(Object.keys(template.findResources('AWS::DynamoDB::Table')).sort()).toEqual(TABLE_LOGICAL_IDS);
      expect(Object.keys(template.findResources('AWS::S3::Bucket'))).toEqual(['blobStore']);
      expect(Object.keys(template.findResources('AWS::S3::BucketPolicy'))).toEqual(['blobStorePolicy']);
    });

    it.each([
      ['configTableArn',       'configTable'],
      ['itemTableArn',         'itemTable'],
      ['changelogTableArn',    'changelogTable'],
      ['auditLogTableArn',     'auditLogTable'],
      ['mailFeedbackTableArn', 'mailFeedbackTable'],
      ['patTableArn',          'patTable'],
      ['blobStoreArn',         'blobStore'],
    ])('outputs %s as the ARN of %s', (outputName, logicalId) => {
      synthDataStack().hasOutput(outputName, { Value: { 'Fn::GetAtt': [logicalId, 'Arn'] } });
    });
  });

  describe('names', () => {
    it('derives every table name and the blob bucket name from the nameBase parameter', () => {
      const template = synthDataStack();

      template.allResourcesProperties('AWS::DynamoDB::Table', {
        TableName: { 'Fn::Join': ['', Match.arrayWith([{ Ref: 'nameBase' }])] },
      });
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: { 'Fn::Join': ['', Match.arrayWith([{ Ref: 'nameBase' }])] },
      });
    });
  });

  describe('production', () => {
    it('retains every table on delete and update, with point-in-time recovery', () => {
      const template = synthDataStack();

      template.allResources('AWS::DynamoDB::Table', { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
      template.allResourcesProperties('AWS::DynamoDB::Table', { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } });
    });

    it('retains the blob bucket and versions its objects', () => {
      const template = synthDataStack();

      template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
      template.hasResourceProperties('AWS::S3::Bucket', { VersioningConfiguration: { Status: 'Enabled' } });
    });
  });

  describe('development mode', () => {
    it('drops point-in-time recovery from every table', () => {
      synthDataStack({ development: true }).allResourcesProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      });
    });

    it('deletes the tables and the blob bucket with the stack, without versioning', () => {
      const template = synthDataStack({ development: true });

      template.allResources('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
      template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
      template.hasResourceProperties('AWS::S3::Bucket', { VersioningConfiguration: Match.absent() });
    });
  });

  describe('token table', () => {
    it.each([
      ['production', false],
      ['development mode', true],
    ])('keeps the removal policy, point-in-time recovery and tags of the items table in %s', (_title, development) => {
      const template  = synthDataStack({ development });
      const patTable  = tableNamed(template, 'patTable');
      const itemTable = tableNamed(template, 'itemTable');

      expect(patTable.deletionPolicy).toEqual(itemTable.deletionPolicy);
      expect(patTable.updateReplacePolicy).toEqual(itemTable.updateReplacePolicy);
      expect(patTable.properties.PointInTimeRecoverySpecification)
        .toEqual(itemTable.properties.PointInTimeRecoverySpecification);
      expect(baseTagsOf(patTable)).toEqual(baseTagsOf(itemTable));
    });

    it('projects keys only in both secondary indexes', () => {
      const patTable = tableNamed(synthDataStack(), 'patTable');

      expect(patTable.properties.GlobalSecondaryIndexes).toEqual([
        expect.objectContaining({ IndexName: 'gsi1', Projection: { ProjectionType: 'KEYS_ONLY' } }),
        expect.objectContaining({ IndexName: 'gsi2', Projection: { ProjectionType: 'KEYS_ONLY' } }),
      ]);
    });
  });

  describe('KMS', () => {
    it('encrypts every table and the blob bucket with the customer-managed key it is given', () => {
      const keyArn = 'arn:aws:kms:us-west-2:123456789012:key/11111111-2222-3333-4444-555555555555';
      const key    = Key.fromKeyArn(new Stack(new App(), 'KeyStack'), 'key', keyArn);

      const template = synthDataStack({ kms: { mode: MailboxKmsMode.CUSTOMER_MANAGED, key } });

      template.allResourcesProperties('AWS::DynamoDB::Table', { SSESpecification: { SSEEnabled: true, SSEType: 'KMS', KMSMasterKeyId: keyArn } });
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: keyArn } }],
        },
      });
    });
  });
});
