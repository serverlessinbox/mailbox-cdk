/// <reference types="jest" />

/**
 * EmailSenderLambda IAM Scoping Tests
 *
 * Verifies:
 * - ses:SendRawEmail is scoped by aws:ResourceTag/serverless-inbox:root-stack matching the
 *   stack's own name, rather than granted on an unconditioned wildcard resource.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PinnedResolver, CdkArtifactEngine, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
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
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
    });
  });

  it('scopes ses:SendRawEmail by the root-stack resource tag', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendRawEmail',
            Resource: '*',
            Condition: {
              StringEquals: {
                [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' },
              },
            },
          }),
        ]),
      },
    });
  });

  it('does not grant ses:SendRawEmail unconditionally', () => {
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('ses:SendRawEmail')) {
          expect(statement.Condition).toBeDefined();
        }
      }
    }
  });
});
