/**
 * MailboxDataStack template synthesis tests.
 *
 * Pins what the data stack itself decides in its synthesized template: the root-stack tag contract on
 * its tables and buckets, the IAM wildcard guard across the stack, the table count and the correlation
 * parameters, and the retention and point-in-time recovery the stack hands its tables. Each table and
 * bucket owns its own settings in its own test file.
 */

import { actionsOf, resourcesOf, statementsOfDocument } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                     from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import {
  CloudFormationResource,
  KNOWN_WILDCARDS,
  isResourceOfType,
  readTags,
} from '../../../__tests__/iam-test-helpers';
import { MailboxDataStack }                             from '../mailbox-data-stack';

/** IAM and CloudWatch Logs actions that change state. Granted on `*` only when allowlisted. */
const WRITE_ACTIONS = new Set([
  'iam:CreateRole',
  'iam:DeleteRole',
  'iam:PutRolePolicy',
  'iam:DeleteRolePolicy',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'logs:CreateLogGroup',
  'logs:DeleteLogGroup',
  'logs:CreateLogStream',
  'logs:DeleteLogStream',
  'logs:PutLogEvents',
]);

function synthDataStack(): Template {
  const app   = new App();
  const stack = new MailboxDataStack(app, 'TestMailboxData', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  return Template.fromStack(stack);
}

function resourcesOfTemplate(template: Template): Record<string, CloudFormationResource> {
  const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
  if (!resources) {
    throw new Error('No resources found in template');
  }
  return resources;
}

describe('MailboxDataStack template synthesis', () => {
  describe('tag contract', () => {
    it('tags every table and bucket with the rootStack parameter', () => {
      const resources = resourcesOfTemplate(synthDataStack());

      let taggedResourceCount = 0;
      for (const resource of Object.values(resources)) {
        if (!isResourceOfType(resource, 'AWS::DynamoDB::Table') && !isResourceOfType(resource, 'AWS::S3::Bucket')) {continue;}

        const tags = readTags(resource);
        if (tags === undefined) {continue;}
        taggedResourceCount++;

        const rootStackTag = tags.find((tag) => tag.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag?.Value).toEqual({ Ref: 'rootStack' });
      }

      expect(taggedResourceCount).toBeGreaterThan(2);
    });

    it('declares a mandatory rootStackId parameter and tags its tables and buckets with it', () => {
      const template   = synthDataStack();
      const parameters = template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>;
      expect(parameters.rootStackId).toEqual(expect.objectContaining({ Type: 'String' }));
      expect(parameters.rootStackId.Default).toBeUndefined();

      const tagged = Object.values(resourcesOfTemplate(template)).filter(
        (resource) => (isResourceOfType(resource, 'AWS::DynamoDB::Table') || isResourceOfType(resource, 'AWS::S3::Bucket')) && readTags(resource) !== undefined,
      );
      expect(tagged.length).toBeGreaterThan(2);
      for (const resource of tagged) {
        const tag = readTags(resource)?.find((candidate) => candidate.Key === 'serverless-inbox:root-stack-id');
        expect(tag?.Value).toEqual({ Ref: 'rootStackId' });
      }
    });
  });

  describe('IAM wildcard guard', () => {
    it('grants no IAM or logs write action on Resource "*" without a Condition, in any policy of the stack', () => {
      const violations: string[] = [];

      for (const [logicalId, resource] of Object.entries(resourcesOfTemplate(synthDataStack()))) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}

        for (const statement of statementsOfDocument(resource.Properties?.PolicyDocument)) {
          const resourceList = resourcesOf(statement);

          for (const action of actionsOf(statement)) {
            if (WRITE_ACTIONS.has(action) && resourceList.includes('*') && !statement.Condition && !KNOWN_WILDCARDS[action]) {
              violations.push(`${logicalId}: ${action} on Resource "*" without Condition`);
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('construct quality', () => {
    it('synthesizes at least four data tables and one blob bucket', () => {
      const resources = Object.values(resourcesOfTemplate(synthDataStack()));

      expect(resources.filter((resource) => isResourceOfType(resource, 'AWS::DynamoDB::Table')).length).toBeGreaterThanOrEqual(4);
      expect(resources.filter((resource) => isResourceOfType(resource, 'AWS::S3::Bucket')).length).toBeGreaterThanOrEqual(1);
    });

    it('exposes the root-stack correlation parameters', () => {
      const parameters: unknown = synthDataStack().toJSON().Parameters ?? {};

      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('nameBase');
    });

    it('names every table and the blob bucket from the nameBase parameter, never from the stack name', () => {
      const resources       = resourcesOfTemplate(synthDataStack());
      const tableLogicalIds = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'];

      for (const logicalId of tableLogicalIds) {
        const tableName = JSON.stringify(resources[logicalId]?.Properties?.TableName);
        expect(tableName).toContain('nameBase');
        expect(tableName).not.toContain('AWS::StackName');
      }

      const bucketName = JSON.stringify(resources.blobStore?.Properties?.BucketName);
      expect(bucketName).toContain('nameBase');
      expect(bucketName).toContain('blob-store');
      expect(bucketName).not.toContain('AWS::StackName');
    });

    it('retains every DynamoDB table on delete and update', () => {
      const tables = Object.values(resourcesOfTemplate(synthDataStack())).filter((resource) => isResourceOfType(resource, 'AWS::DynamoDB::Table')) as Array<CloudFormationResource & { DeletionPolicy?: string; UpdateReplacePolicy?: string }>;

      expect(tables.length).toBeGreaterThanOrEqual(4);
      for (const table of tables) {
        // Values from the synthesized output of RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE (base-table.ts).
        expect(table.DeletionPolicy).toEqual('RetainExceptOnCreate');
        expect(table.UpdateReplacePolicy).toEqual('Retain');
      }
    });

    it('enables point-in-time recovery on every data table the stack creates', () => {
      const tables = Object.values(resourcesOfTemplate(synthDataStack())).filter((resource) => isResourceOfType(resource, 'AWS::DynamoDB::Table'));

      expect(tables.length).toBeGreaterThanOrEqual(5);
      for (const table of tables) {
        const pitrSpec = table.Properties?.PointInTimeRecoverySpecification as Record<string, unknown> | undefined;
        expect(pitrSpec?.PointInTimeRecoveryEnabled).toBe(true);
      }
    });
  });
});
