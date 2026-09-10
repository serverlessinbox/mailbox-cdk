/// <reference types="jest" />

/**
 * AdminApiLambda IAM Scoping Tests
 *
 * Verifies:
 * - grantSesAccess scopes identity-management SES actions to the identity ARN pattern, and
 *   ses:SendEmail (which binds to both the identity and configuration-set resource types) to
 *   both ARNs in its own statement, leaving account-level actions on '*'.
 * - grantLicenseApiAccess scopes execute-api:Invoke to method+path against the vendor account.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { AdminApiLambda } from '../admin-api';
import { VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';

describe('AdminApiLambda IAM scoping', () => {
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
    const auditLogTable = new Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const changelogTable = new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const mailFeedbackTable = new Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    });
    const blobStore = new Bucket(stack, 'blob-store');
    const emailSubmissionQueue = new Queue(stack, 'email-submission-queue');
    const auditEventsQueue = new Queue(stack, 'audit-events-queue');
    const identityProvisionerFunction = LambdaFunction.fromFunctionArn(
      stack,
      'identity-provisioner-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    );

    new AdminApiLambda(stack, 'admin-api', {
      configTable,
      itemTable,
      auditLogTable,
      changelogTable,
      mailFeedbackTable,
      blobStore,
      emailSubmissionQueue,
      auditEventsQueue,
      artifactResolver,
      identityProvisionerFunction,
      sesRuleSetName: 'test-rule-set',
      sesConfigSetName: 'test-config-set',
      systemSenderAddress: 'noreply@example.com',
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
      stackIdentityTagKey: ServerlessInboxTagKeys.rootStack,
    });
  });

  it('scopes identity-management SES actions to the identity ARN pattern only', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              'ses:CreateEmailIdentity',
              'ses:GetEmailIdentity',
              'ses:DeleteEmailIdentity',
              'ses:PutEmailIdentityDkimSigningAttributes',
            ],
            Resource: 'arn:aws:ses:us-west-2:123456789012:identity/*',
          }),
        ]),
      },
    });
  });

  it('scopes ses:SendEmail to its own statement covering both the identity and configuration-set ARNs', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendEmail',
            Resource: [
              'arn:aws:ses:us-west-2:123456789012:identity/*',
              'arn:aws:ses:us-west-2:123456789012:configuration-set/test-config-set',
            ],
          }),
        ]),
      },
    });
  });

  it('leaves account-level SES actions on a wildcard resource', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'ses:GetAccount',
              'ses:GetSendStatistics',
              'ses:ListEmailIdentities',
            ]),
            Resource: '*',
          }),
        ]),
      },
    });
  });

  it('scopes execute-api:Invoke to grant-resource and revoke-resource against the vendor account', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'execute-api:Invoke',
            Resource: Match.arrayWith([
              `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/grant-resource`,
              `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/revoke-resource`,
            ]),
          }),
        ]),
      },
    });
  });

  it('sets STACK_IDENTITY_TAG_VALUE to the stack name', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STACK_IDENTITY_TAG_VALUE: stack.stackName,
        }),
      },
    });
  });

  it('sets STACK_IDENTITY_TAG_KEY to ServerlessInboxTagKeys.rootStack', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STACK_IDENTITY_TAG_KEY: ServerlessInboxTagKeys.rootStack,
        }),
      },
    });
  });

  it('does not grant execute-api:Invoke on a wildcard resource', () => {
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('execute-api:Invoke')) {
          const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
          expect(resources).not.toContain('*');
        }
      }
    }
  });
});
