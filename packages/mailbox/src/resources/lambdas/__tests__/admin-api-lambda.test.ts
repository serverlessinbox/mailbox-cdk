/// <reference types="jest" />

/**
 * AdminApiLambda wrapper tests.
 *
 * Pins the IAM scope of every statement the wrapper grants: identity-management SES actions on
 * the identity ARN pattern, ses:SendEmail (which binds to both the identity and configuration-set
 * resource types) on both ARNs, account-level actions on '*', Route53 writes limited by condition
 * keys, and execute-api:Invoke limited to exact method and path on the vendor account. A widened
 * statement stays green in synth and tsc, so these assertions are the only guard.
 *
 * The environment variable names are literals on purpose: the Lambda runtime reads them, so a
 * rename in the wrapper must fail here.
 */

import { ServerlessInboxTagKeys, StackIdentity, VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                          from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                     from 'aws-cdk-lib/aws-dynamodb';
import { Function as LambdaFunction }                               from 'aws-cdk-lib/aws-lambda';
import { Bucket }                                                   from 'aws-cdk-lib/aws-s3';
import type * as cdk                                                from 'aws-cdk-lib';

import type { IWebSocketBroadcastPublisher }                        from '../../../contracts/websocket-push';
import { DataBlobStore }                                            from '../../buckets/data-blob-store';
import { AuditEventsQueue }                                         from '../../queues/audit-events-queue';
import { EmailSendingQueue }                                        from '../../queues/email-sending-queue';
import { DataTable }                                                from '../../tables/data-tables';
import { AdminApiLambda }                                           from '../admin-api-lambda';

import { arrangeWrapperStack }                                      from './lambda-wrapper-helpers';

function rootStackIdOf(stack: cdk.Stack): unknown {
  return stack.resolve(StackIdentity.guid);
}

describe('AdminApiLambda IAM scoping', () => {
  let stack: cdk.Stack;
  let lambda: AdminApiLambda;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable                 = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable                   = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const auditLogTable               = new DataTable(new Table(stack, 'audit-log-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const changelogTable              = new DataTable(new Table(stack, 'changelog-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const mailFeedbackTable           = new DataTable(new Table(stack, 'mail-feedback-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const blobStore                   = new DataBlobStore(new Bucket(stack, 'blob-store'));
    const emailSubmissionQueue        = new EmailSendingQueue(stack, 'email-submission-queue');
    const auditEventsQueue            = new AuditEventsQueue(stack, 'audit-events-queue');
    const identityProvisionerFunction = LambdaFunction.fromFunctionArn(
      stack,
      'identity-provisioner-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:identity-provisioner',
    );

    lambda = new AdminApiLambda(stack, 'admin-api', {
      configTable,
      itemTable,
      auditLogTable,
      changelogTable,
      mailFeedbackTable,
      blobStore,
      emailSubmissionQueue,
      auditEventsQueue,
      artifactResolver:    arrangement.artifactResolver,
      identityProvisioner: identityProvisionerFunction,
      sesRuleSetName:      'test-rule-set',
      sesConfigSetName:    'test-config-set',
      systemSenderAddress: 'noreply@example.com',
      vendorLink:          { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
    });
  });

  it('scopes identity-management SES actions to the identity ARN pattern only', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action:   [
              'ses:CreateEmailIdentity',
              'ses:GetEmailIdentity',
              'ses:DeleteEmailIdentity',
              'ses:PutEmailIdentityDkimSigningAttributes',
            ],
            Resource: {
              'Fn::Join': [
                '',
                ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*'],
              ],
            },
          }),
        ]),
      },
    });
  });

  it('scopes ses:TagResource to its own pair of statements: a request carrying the root stack id, or only its name', () => {
    const template    = Template.fromStack(stack);
    const rootStackId = rootStackIdOf(stack);
    const identityArn = {
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*']],
    };
    const tagKeys     = { 'aws:TagKeys': [ServerlessInboxTagKeys.rootStack, ServerlessInboxTagKeys.rootStackId] };
    const conditions  = [
      Match.objectEquals({
        StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: rootStackId },
        'ForAllValues:StringEquals': tagKeys,
      }),
      Match.objectEquals({
        StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: 'TestStack' },
        Null:                        { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: 'true' },
        'ForAllValues:StringEquals': tagKeys,
      }),
    ];
    for (const Condition of conditions) {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'ses:TagResource', Resource: identityArn, Condition }),
          ]),
        },
      });
    }
  });

  it('sets ROOT_STACK_ID to the stack guid', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ ROOT_STACK_ID: rootStackIdOf(stack) }) },
    });
  });

  it('scopes ses:SendEmail to its own statement covering both the identity and configuration-set ARNs', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action:   'ses:SendEmail',
            Resource: [
              {
                'Fn::Join': [
                  '',
                  ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*'],
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    'arn:', { Ref: 'AWS::Partition' }, ':ses:',
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
            Action:   Match.arrayWith([
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

  it('scopes execute-api:Invoke to exactly grant-resource and revoke-resource on the vendor account', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action:   'execute-api:Invoke',
            Resource: [
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/grant-resource`]] },
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/revoke-resource`]] },
            ],
          }),
        ]),
      },
    });
  });

  it('sets SES_RULE_SET_NAME and grants ses:DescribeActiveReceiptRuleSet on a wildcard resource', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SES_RULE_SET_NAME: 'test-rule-set' }) },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'ses:DescribeActiveReceiptRuleSet', Resource: '*' }),
        ]),
      },
    });
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the broadcaster grant itself invokable', () => {
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush(broadcaster);

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn' }) },
    });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(lambda);
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

  it('scopes underscore-prefixed Route53 records (DKIM, DMARC) with record-name conditions', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action:    'route53:ChangeResourceRecordSets',
            Resource:  { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':route53:::hostedzone/*']] },
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
            Action:    'route53:ChangeResourceRecordSets',
            Condition: Match.objectLike({
              'ForAllValues:StringLike':   Match.objectLike({
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
            Action:    'route53:ChangeResourceRecordSets',
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

  it('includes an explicit deny for ACME challenge records', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect:    'Deny',
            Action:    'route53:ChangeResourceRecordSets',
            Resource:  '*',
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
            Action:    'route53:ChangeResourceRecordSets',
            Resource:  { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':route53:::hostedzone/*']] },
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
            Action:   'route53:ListResourceRecordSets',
            Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':route53:::hostedzone/*']] },
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
            Action:   'route53:ListHostedZonesByName',
            Resource: '*',
          }),
        ]),
      },
    });
  });
});
