/**
 * MailboxDataStack template synthesis tests.
 *
 * Pins the synthesized template of the data stack: the root-stack tag contract on its tables and
 * buckets, the S3 public-access and lifecycle settings, the DynamoDB retention and PITR settings, and
 * the grants of the data deployer worker. A regression that tagged a table with the wrong value,
 * exposed a bucket, or granted writes on `*` fails the matching case below.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                             from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, resourcesOf, statementsOfDocument } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ArtifactObject, DeployedStack }                from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                     from 'aws-cdk-lib/assertions';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import { MailboxDataStack }                             from '../core/data/mailbox-data-stack';
import { MailboxDataDeployerWorkerLambda }              from '../resources/lambdas/mailbox-data-deployer-worker-lambda';

import {
  CloudFormationResource,
  KNOWN_WILDCARDS,
  isResourceOfType,
  readTags,
} from './iam-test-helpers';

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

/** The DynamoDB and S3 actions the worker must scope to the deterministic resource-name pattern. */
const SCOPED_WRITE_ACTIONS = new Set([
  'dynamodb:CreateTable', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable',
  's3:CreateBucket', 's3:DeleteBucket', 's3:PutBucketPolicy',
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

    it('gives every bucket the public access block with all four flags set', () => {
      const buckets = Object.values(resourcesOfTemplate(synthDataStack())).filter((resource) => isResourceOfType(resource, 'AWS::S3::Bucket'));

      expect(buckets.length).toBeGreaterThan(0);
      for (const bucket of buckets) {
        const blockConfig = bucket.Properties?.PublicAccessBlockConfiguration as Record<string, boolean> | undefined;
        expect(blockConfig).toEqual({
          BlockPublicAcls:       true,
          BlockPublicPolicy:     true,
          IgnorePublicAcls:      true,
          RestrictPublicBuckets: true,
        });
      }
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
  });

  describe('point-in-time recovery', () => {
    it('enables PITR on all five data tables', () => {
      const tables = Object.values(resourcesOfTemplate(synthDataStack())).filter((resource) => isResourceOfType(resource, 'AWS::DynamoDB::Table'));

      expect(tables.length).toBeGreaterThanOrEqual(5);
      for (const table of tables) {
        const pitrSpec = table.Properties?.PointInTimeRecoverySpecification as Record<string, unknown> | undefined;
        expect(pitrSpec?.PointInTimeRecoveryEnabled).toBe(true);
      }
    });
  });

  describe('S3 lifecycle rules', () => {
    it('expires uploads/ objects after one day through a prefix filter with no tag filter', () => {
      const bucketRules = Object.values(resourcesOfTemplate(synthDataStack()))
        .filter((resource) => isResourceOfType(resource, 'AWS::S3::Bucket'))
        .map((bucket) => (bucket.Properties?.LifecycleConfiguration as { Rules?: Array<Record<string, unknown>> } | undefined)?.Rules ?? []);

      const uploadRules = bucketRules.flat().filter((rule) => rule.Id === 'DeleteUploadedBlobs');
      expect(uploadRules).toHaveLength(1);
      const [uploadRule] = uploadRules;
      expect(uploadRule).toMatchObject({ Status: 'Enabled', Prefix: 'uploads/', ExpirationInDays: 1 });
      expect(uploadRule).not.toHaveProperty('TagFilters');
    });

    it('expires unhandled incoming emails after seven days through a prefix filter', () => {
      const bucketRules = Object.values(resourcesOfTemplate(synthDataStack()))
        .filter((resource) => isResourceOfType(resource, 'AWS::S3::Bucket'))
        .map((bucket) => (bucket.Properties?.LifecycleConfiguration as { Rules?: Array<Record<string, unknown>> } | undefined)?.Rules ?? []);

      const incomingRules = bucketRules.flat().filter((rule) => rule.Id === 'DeleteUnhandledIncomingEmails');
      expect(incomingRules).toHaveLength(1);
      const [incomingRule] = incomingRules;
      expect(incomingRule).toMatchObject({ Status: 'Enabled', Prefix: 'incoming-emails/', ExpirationInDays: 7 });
    });
  });

  describe('deployer worker IAM', () => {
    it('scopes DynamoDB and S3 write actions to the deterministic resource-name pattern, never Resource "*"', () => {
      const app       = new App();
      const testStack = new cdk.Stack(app, 'TestDataDeployerStack', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const packages: Record<string, ArtifactPin> = {
        'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      };
      const artifactResolver                      = new PinnedArtifactResolver({
        packages,
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: testStack.region,
      });

      new MailboxDataDeployerWorkerLambda(testStack, 'worker', {
        artifactResolver,
        dataStack:     new DeployedStack('arn:aws:cloudformation:us-west-2:123456789012:stack/test-root-data/*'),
        dataStackName: 'test-root-data',
        template:      new ArtifactObject(artifactResolver, 'mailbox-cdk-shared', 'template.json'),
        nameBase:      'test-root-data',
      });

      const resources              = resourcesOfTemplate(Template.fromStack(testStack));
      const violations: string[]   = [];
      const scopedGrants: string[] = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}

        for (const statement of statementsOfDocument(resource.Properties?.PolicyDocument)) {
          const resourceList = resourcesOf(statement);

          for (const action of actionsOf(statement)) {
            if (SCOPED_WRITE_ACTIONS.has(action)) {
              scopedGrants.push(action);
              if (resourceList.includes('*')) {
                violations.push(`${logicalId}: ${action} granted on bare Resource "*" (expected deterministic name-pattern scoping)`);
              }
            }
            if (WRITE_ACTIONS.has(action) && resourceList.includes('*') && !statement.Condition && !KNOWN_WILDCARDS[action]) {
              violations.push(`${logicalId}: ${action} on Resource "*" without Condition`);
            }
          }
        }
      }

      expect(scopedGrants.length).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    });
  });
});
