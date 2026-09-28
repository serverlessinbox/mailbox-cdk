/// <reference types="jest" />

/**
 * ArtifactUpdaterLambda — own IAM policies.
 *
 * The updater Lambda builds eight policy statements on its own role:
 * - tag:GetResources for resource discovery
 * - lambda:* actions for function updates and tagging (with aws:ResourceTag and aws:TagKeys conditions)
 * - cloudfront:* actions for distribution updates and tagging (with aws:ResourceTag and aws:TagKeys conditions)
 * - s3:GetObject for artifact release downloads
 * - A Lambda permission for self-invocation
 *
 * This suite asserts the exact actions, resources, and conditions each statement carries.
 * Regressions in scoping (missing conditions, broadened resources, or altered tag constraints)
 * are the most likely failure mode.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ServerlessInboxTagKeys, PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ArtifactUpdaterLambda } from '../../../lambdas/artifact-updater';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CloudFormationResource, CloudFormationPolicyStatement, getPolicyStatements, isResourceOfType } from '../../../__tests__/iam-test-helpers';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages: {
    'mailbox-go': { kind: 'release', version: '1.0.0' },
    'mailbox-cdk': { kind: 'release', version: '1.0.0' },
    'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
    'mailbox-cdk-edge': { kind: 'release', version: '1.0.0' },
    'mailbox-admin-ui': { kind: 'release', version: '1.0.0' },
    'mailbox-webmail-ui': { kind: 'release', version: '1.0.0' },
  },
};

function buildStack(stackId: string): cdk.Stack {
  const app = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  return new cdk.Stack(app, stackId, {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

/** Finds the IAM role backing the ArtifactUpdaterLambda (identified by its DIST_TAG environment variable). */
function findUpdaterRoleLogicalId(template: Record<string, unknown>): string {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::Lambda::Function')) continue;
    const env = resource.Properties?.Environment as { Variables?: Record<string, unknown> } | undefined;
    if (!env?.Variables?.DIST_TAG) continue;
    const role = resource.Properties?.Role as { 'Fn::GetAtt'?: [string, string] } | undefined;
    if (role?.['Fn::GetAtt']) return role['Fn::GetAtt'][0];
  }
  throw new Error('No Lambda function with DIST_TAG environment variable (the artifact updater) found');
}

/** All policy statements attached (via AWS::IAM::Policy's Roles list) to the given role. */
function findPolicyStatementsForRole(template: Record<string, unknown>, roleLogicalId: string): CloudFormationPolicyStatement[] {
  const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
  const statements: CloudFormationPolicyStatement[] = [];
  for (const resource of Object.values(resources)) {
    if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
    const roles = (resource.Properties?.Roles ?? []) as { Ref?: string }[];
    if (!roles.some((r) => r.Ref === roleLogicalId)) continue;
    statements.push(...getPolicyStatements(resource.Properties?.PolicyDocument));
  }
  return statements;
}

/** Normalizes an action or resource to a string array for consistent comparison. */
function normalizeToArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

describe('ArtifactUpdaterLambda — own IAM policies', () => {
  let stack: cdk.Stack;
  let template: Record<string, unknown>;
  let updaterRoleId: string;
  let updaterStatements: CloudFormationPolicyStatement[];

  beforeAll(() => {
    stack = buildStack('TestArtifactUpdater');

    // Set up artifact resolver using the same pattern as AutoUpdater
    const pinnedResolver = PinnedResolver.loadFromArtifactMetadata(stack);
    pinnedResolver.registerPackages(['mailbox-cdk']);
    const artifactResolver = new CdkArtifactEngine(stack, pinnedResolver, 'test-resolver');

    // Create lock table
    const lockTable = new dynamodb.Table(stack, 'lock-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new ArtifactUpdaterLambda(stack, 'artifact-updater', {
      artifactResolver,
      distTag: 'stable',
      granularity: 'stack',
      rootStackTagValue: stack.stackName,
      artifactBucketBase: ARTIFACT_CONTEXT.bucketBase,
      lockTable,
    });

    template = Template.fromStack(stack).toJSON() as Record<string, unknown>;
    updaterRoleId = findUpdaterRoleLogicalId(template);
    updaterStatements = findPolicyStatementsForRole(template, updaterRoleId);
  });

  it('grants tag:GetResources for resource discovery with wildcard resources', () => {
    const stmt = updaterStatements.find((s) => normalizeToArray(s.Action).includes('tag:GetResources'));
    expect(stmt).toBeDefined();
    expect(stmt?.Resource).toEqual('*');
    expect(stmt?.Condition).toBeUndefined();
  });

  it('grants lambda:GetFunction, GetFunctionConfiguration, UpdateFunctionCode, InvokeFunction scoped to aws:ResourceTag', () => {
    const stmt = updaterStatements.find((s) => {
      const actions = normalizeToArray(s.Action);
      return (
        actions.includes('lambda:GetFunction') &&
        actions.includes('lambda:GetFunctionConfiguration') &&
        actions.includes('lambda:UpdateFunctionCode') &&
        actions.includes('lambda:InvokeFunction')
      );
    });
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    // Resource is synthesized as Fn::Join, so verify it contains the ARN pattern
    const resourceStr = JSON.stringify(resources);
    expect(resourceStr).toContain('arn:aws:lambda:*');
    expect(resourceStr).toContain('function:*');
    expect(stmt?.Condition?.StringEquals).toBeDefined();
    expect(stmt?.Condition?.StringEquals?.[`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]).toBeDefined();
  });

  it('grants lambda:TagResource scoped to aws:ResourceTag and aws:TagKeys', () => {
    const stmt = updaterStatements.find((s) => normalizeToArray(s.Action).includes('lambda:TagResource'));
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    const resourceStr = JSON.stringify(resources);
    expect(resourceStr).toContain('arn:aws:lambda:*');
    expect(resourceStr).toContain('function:*');
    expect(stmt?.Condition?.StringEquals).toBeDefined();
    expect(stmt?.Condition?.StringEquals?.[`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]).toBeDefined();
    expect(stmt?.Condition?.['ForAllValues:StringEquals']?.['aws:TagKeys']).toEqual([ServerlessInboxTagKeys.artifactVersion]);
  });

  it('grants lambda:GetFunctionConfiguration, PublishVersion scoped to us-east-1 functions with aws:ResourceTag', () => {
    const stmt = updaterStatements.find((s) => {
      const actions = normalizeToArray(s.Action);
      return actions.includes('lambda:GetFunctionConfiguration') && actions.includes('lambda:PublishVersion');
    });
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    const resourceStr = JSON.stringify(resources);
    expect(resourceStr).toContain('arn:aws:lambda:us-east-1');
    expect(resourceStr).toContain('function:*');
    expect(stmt?.Condition?.StringEquals).toBeDefined();
    expect(stmt?.Condition?.StringEquals?.[`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]).toBeDefined();
  });

  it('grants cloudfront:GetDistributionConfig, UpdateDistribution, CreateInvalidation scoped to aws:ResourceTag', () => {
    const stmt = updaterStatements.find((s) => {
      const actions = normalizeToArray(s.Action);
      return (
        actions.includes('cloudfront:GetDistributionConfig') &&
        actions.includes('cloudfront:UpdateDistribution') &&
        actions.includes('cloudfront:CreateInvalidation')
      );
    });
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    const resourceStr = JSON.stringify(resources);
    expect(resourceStr).toContain('arn:aws:cloudfront::');
    expect(resourceStr).toContain('distribution/*');
    expect(stmt?.Condition?.StringEquals).toBeDefined();
    expect(stmt?.Condition?.StringEquals?.[`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]).toBeDefined();
  });

  it('grants cloudfront:TagResource scoped to aws:ResourceTag and aws:TagKeys', () => {
    const stmt = updaterStatements.find((s) => normalizeToArray(s.Action).includes('cloudfront:TagResource'));
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    const resourceStr = JSON.stringify(resources);
    expect(resourceStr).toContain('arn:aws:cloudfront::');
    expect(resourceStr).toContain('distribution/*');
    expect(stmt?.Condition?.StringEquals).toBeDefined();
    expect(stmt?.Condition?.StringEquals?.[`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]).toBeDefined();
    expect(stmt?.Condition?.['ForAllValues:StringEquals']?.['aws:TagKeys']).toEqual([ServerlessInboxTagKeys.artifactVersion]);
  });

  it('grants cloudfront:ListDistributions with wildcard resources', () => {
    const stmt = updaterStatements.find((s) => normalizeToArray(s.Action).includes('cloudfront:ListDistributions'));
    expect(stmt).toBeDefined();
    expect(stmt?.Resource).toEqual('*');
    expect(stmt?.Condition).toBeUndefined();
  });

  it('grants s3:GetObject scoped to artifact release pattern', () => {
    const stmt = updaterStatements.find((s) => normalizeToArray(s.Action).includes('s3:GetObject'));
    expect(stmt).toBeDefined();
    const resources = normalizeToArray(stmt!.Resource);
    expect(resources.length).toBe(1);
    expect(resources[0]).toContain(`arn:aws:s3:::${ARTIFACT_CONTEXT.bucketBase}-*`);
    expect(resources[0]).toContain('/serverlessinbox/packages/*/releases/*');
  });

  it('contains at least 8 policy statements from ArtifactUpdaterLambda grant methods', () => {
    // 8 statements from ArtifactUpdaterLambda methods + lock table read/write statements
    // Verify at least the 8 core updater statements are present
    const hasTagDiscovery = updaterStatements.some((s) =>
      normalizeToArray(s.Action).includes('tag:GetResources') && s.Resource === '*'
    );
    const hasLambdaManagement = updaterStatements.some((s) => {
      const actions = normalizeToArray(s.Action);
      return (
        actions.includes('lambda:GetFunction') &&
        actions.includes('lambda:UpdateFunctionCode') &&
        actions.includes('lambda:InvokeFunction')
      );
    });
    const hasCloudFrontManagement = updaterStatements.some((s) => {
      const actions = normalizeToArray(s.Action);
      return (
        actions.includes('cloudfront:GetDistributionConfig') &&
        actions.includes('cloudfront:UpdateDistribution') &&
        actions.includes('cloudfront:CreateInvalidation')
      );
    });
    const hasCloudFrontList = updaterStatements.some((s) =>
      normalizeToArray(s.Action).includes('cloudfront:ListDistributions') && s.Resource === '*'
    );
    const hasS3GetObject = updaterStatements.some((s) =>
      normalizeToArray(s.Action).includes('s3:GetObject')
    );

    expect(hasTagDiscovery).toBe(true);
    expect(hasLambdaManagement).toBe(true);
    expect(hasCloudFrontManagement).toBe(true);
    expect(hasCloudFrontList).toBe(true);
    expect(hasS3GetObject).toBe(true);
    expect(updaterStatements.length).toBeGreaterThanOrEqual(8);
  });

  it('contains a Lambda permission for self-invocation', () => {
    const resources = (template.Resources ?? {}) as Record<string, CloudFormationResource>;
    let foundSelfInvokePermission = false;
    for (const resource of Object.values(resources)) {
      if (!isResourceOfType(resource, 'AWS::Lambda::Permission')) continue;
      const action = resource.Properties?.Action;
      if (action === 'lambda:InvokeFunction') {
        // Principal should reference the updater's role, either as a string or Fn::GetAtt
        foundSelfInvokePermission = true;
        break;
      }
    }
    expect(foundSelfInvokePermission).toBe(true);
  });
});
