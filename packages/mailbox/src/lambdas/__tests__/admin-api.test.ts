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
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { AdminApiLambda } from '../admin-api';
import { VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import { AuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import { EmailSendingQueue } from '../../email/sending/email-sending-queue';
import { DataTable } from '../../data/data-tables';
import { DataBlobStore } from '../../data/data-blob-store';

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

    const configTable = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const auditLogTable = new DataTable(new Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const mailFeedbackTable = new DataTable(new Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const blobStore = new DataBlobStore(new Bucket(stack, 'blob-store'));
    const emailSubmissionQueue = new EmailSendingQueue(stack, 'email-submission-queue');
    const auditEventsQueue = new AuditEventsQueue(stack, 'audit-events-queue');
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
            Resource: {
              'Fn::Join': [
                '',
                ['arn:aws:ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*'],
              ],
            },
          }),
        ]),
      },
    });
  });

  it('scopes ses:TagResource to its own statement gated by RequestTag and TagKeys', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:TagResource',
            Resource: {
              'Fn::Join': [
                '',
                ['arn:aws:ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*'],
              ],
            },
            Condition: {
              StringEquals: {
                [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: 'TestStack',
              },
              'ForAllValues:StringEquals': {
                'aws:TagKeys': [ServerlessInboxTagKeys.rootStack],
              },
            },
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
              {
                'Fn::Join': [
                  '',
                  ['arn:aws:ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*'],
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    'arn:aws:ses:',
                    { Ref: 'AWS::Region' },
                    ':',
                    { Ref: 'AWS::AccountId' },
                    ':configuration-set/test-config-set',
                  ],
                ],
              },
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

  it('scopes underscore-prefixed Route53 records (DKIM, DMARC) with record-name conditions', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ChangeResourceRecordSets',
            Resource: 'arn:aws:route53:::hostedzone/*',
            Condition: Match.objectLike({
              'ForAllValues:StringLike': Match.objectLike({
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['*._domainkey.*', '_dmarc.*'],
              }),
            }),
          }),
        ]),
      },
    });
  });

  it('restricts underscore-prefixed Route53 records to CNAME and TXT types', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ChangeResourceRecordSets',
            Condition: Match.objectLike({
              'ForAllValues:StringLike': Match.objectLike({
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['*._domainkey.*', '_dmarc.*'],
              }),
              'ForAllValues:StringEquals': Match.objectLike({
                'route53:ChangeResourceRecordSetsRecordTypes': ['CNAME', 'TXT'],
              }),
            }),
          }),
        ]),
      },
    });
  });

  it('restricts Route53 ChangeResourceRecordSets to UPSERT and DELETE actions only', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ChangeResourceRecordSets',
            Condition: Match.objectLike({
              'ForAllValues:StringEquals': Match.objectLike({
                'route53:ChangeResourceRecordSetsActions': ['UPSERT', 'DELETE'],
              }),
            }),
          }),
        ]),
      },
    });
  });

  it('does not permit CREATE action on Route53 records', () => {
    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policyRecord of Object.values(policies)) {
      const policy = policyRecord as any;
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('route53:ChangeResourceRecordSets') && statement.Effect !== 'Deny') {
          const conditions = statement.Condition as Record<string, any> | undefined;
          if (conditions) {
            for (const condValues of Object.values(conditions)) {
              if (typeof condValues === 'object' && condValues !== null) {
                const allowedActions = (condValues as any)['route53:ChangeResourceRecordSetsActions'];
                if (Array.isArray(allowedActions)) {
                  expect(allowedActions).not.toContain('CREATE');
                }
              }
            }
          }
        }
      }
    }
  });

  it('includes an explicit deny for ACME challenge records', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 'route53:ChangeResourceRecordSets',
            Resource: '*',
            Condition: Match.objectLike({
              'ForAnyValue:StringLike': Match.objectLike({
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['_acme-challenge.*'],
              }),
            }),
          }),
        ]),
      },
    });
  });

  it('scopes apex Route53 records (MX, SPF) to type conditions without name prefix restrictions', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ChangeResourceRecordSets',
            Resource: 'arn:aws:route53:::hostedzone/*',
            Condition: Match.objectLike({
              'ForAllValues:StringEquals': Match.objectLike({
                'route53:ChangeResourceRecordSetsRecordTypes': ['MX', 'TXT'],
              }),
            }),
          }),
        ]),
      },
    });
  });

  it('scopes ListResourceRecordSets to hosted zone resources', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ListResourceRecordSets',
            Resource: 'arn:aws:route53:::hostedzone/*',
          }),
        ]),
      },
    });
  });

  it('scopes ListHostedZonesByName to wildcard resource', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'route53:ListHostedZonesByName',
            Resource: '*',
          }),
        ]),
      },
    });
  });
});
