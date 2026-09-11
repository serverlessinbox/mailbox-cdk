/// <reference types="jest" />

/**
 * EmailSenderLambda IAM Scoping Tests
 *
 * Verifies:
 * - ses:SendRawEmail is scoped to specific SES resource ARNs (email identities and configuration set),
 *   rather than granted on an unconditioned wildcard resource.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { EmailSenderLambda } from '../email-sender';

describe('EmailSenderLambda IAM scoping', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-go': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-go']);
    artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);

    const configTable = new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const itemTable = new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const changelogTable = new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const blobStore = new Bucket(stack, 'blob-store');

    new EmailSenderLambda(stack, 'email-sender', {
      configTable,
      itemTable,
      changelogTable,
      blobStore,
      sesConfigSetName: 'test-config-set',
      artifactResolver,
    });
  });

  it('scopes ses:SendRawEmail to identity and configuration-set ARNs without condition', () => {
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');

    // Find the statement that grants ses:SendRawEmail
    let foundStatement = false;
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('ses:SendRawEmail')) {
          foundStatement = true;

          // Verify there is no Condition block
          expect(statement.Condition).toBeUndefined();

          // Verify the resources are an array with two elements
          expect(Array.isArray(statement.Resource)).toBe(true);
          expect(statement.Resource.length).toBe(2);

          // Verify both resources are properly formed with account/region tokens
          const [identityArn, configSetArn] = statement.Resource;

          // Check identity ARN contains the partition and region tokens
          expect(JSON.stringify(identityArn)).toContain('AWS::Partition');
          expect(JSON.stringify(identityArn)).toContain('AWS::Region');
          expect(JSON.stringify(identityArn)).toContain('AWS::AccountId');
          expect(JSON.stringify(identityArn)).toContain('identity/*');

          // Check config-set ARN contains the partition, region, and config-set name
          expect(JSON.stringify(configSetArn)).toContain('AWS::Partition');
          expect(JSON.stringify(configSetArn)).toContain('AWS::Region');
          expect(JSON.stringify(configSetArn)).toContain('AWS::AccountId');
          expect(JSON.stringify(configSetArn)).toContain('test-config-set');
        }
      }
    }

    expect(foundStatement).toBe(true);
  });

  it('does not grant ses:SendRawEmail on wildcard resources', () => {
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('ses:SendRawEmail')) {
          // Ensure resources are not a bare wildcard
          expect(statement.Resource).not.toEqual('*');
          // Resources should be an array of specific ARNs
          expect(Array.isArray(statement.Resource)).toBe(true);
          expect((statement.Resource as string[]).length).toBeGreaterThan(0);
        }
      }
    }
  });
});
