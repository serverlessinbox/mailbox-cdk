/// <reference types="jest" />

/**
 * BootstrapLambda wrapper tests.
 *
 * The environment variable names asserted here are written as literals on purpose: the Lambda
 * runtime reads them, so a rename in the wrapper must fail these tests. The optional SES
 * variables must be absent unless their prop is set, and every IAM statement the wrapper
 * grants is pinned to the scope it is meant to have.
 */

import { ArtifactZone, PinnedArtifactResolver }                                      from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }                                       from '@serverlessinbox/artifact-registry-cdk';
import { statementsForAction }                                                       from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { DynamoDbActions, VENDOR_ACCOUNT_ID, ServerlessInboxTagKeys, StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                                           from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                                                      from 'aws-cdk-lib/aws-dynamodb';
import { HostedZone }                                                                from 'aws-cdk-lib/aws-route53';
import { ReceiptRuleSet }                                                            from 'aws-cdk-lib/aws-ses';
import * as cdk                                                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                                             from 'aws-cdk-lib';

import { AuthKeyStoreTable }                                                         from '../../tables/auth-key-store-table';
import { DataTable }                                                                 from '../../tables/data-tables';
import { BootstrapLambda }                                                           from '../bootstrap-lambda';
import type { BootstrapLambdaProps }                                                 from '../bootstrap-lambda';

describe('BootstrapLambda', () => {
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;
  let configTable: DataTable;
  let authKeyStoreTable: AuthKeyStoreTable;
  let sesRuleSet: ReceiptRuleSet;

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactPin> = {
      'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver                            = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    configTable       = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store');
    sesRuleSet        = new ReceiptRuleSet(stack, 'ses-rule-set', {});
  });

  function synthBootstrap(overrides: Partial<BootstrapLambdaProps> = {}): Template {
    new BootstrapLambda(stack, 'bootstrap', {
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet,
      vendorLink: { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
      ...overrides,
    });

    return Template.fromStack(stack);
  }

  function hasEnvironment(template: Template, variables: Record<string, unknown>): void {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike(variables) },
    });
  }

  function hasStatement(template: Template, statement: Record<string, unknown>): void {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike(statement)]) },
    });
  }

  function identityArn(identity: string): unknown {
    return {
      'Fn::Join': ['', ['arn:aws:ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, `:identity/${identity}`]],
    };
  }

  describe('environment', () => {
    it('sets the table names, the stack identity and the SES rule set name', () => {
      const template = synthBootstrap();

      hasEnvironment(template, {
        CONFIG_TABLE_NAME:         Match.anyValue(),
        AUTH_KEY_STORE_TABLE_NAME: Match.anyValue(),
        STACK_IDENTITY_TAG_VALUE:  'TestStack',
        STACK_IDENTITY_TAG_KEY:    ServerlessInboxTagKeys.rootStack,
        SES_RULE_SET_NAME:         Match.anyValue(),
      });
    });

    it('sets ROOT_STACK_ID to the stack guid', () => {
      const template = synthBootstrap();

      hasEnvironment(template, { ROOT_STACK_ID: stack.resolve(StackIdentity.guid) });
    });

    it('omits SES_RECEIVING_MODE and SES_SEND_ENABLED when their props are not set', () => {
      const template = synthBootstrap();

      hasEnvironment(template, {
        SES_RECEIVING_MODE: Match.absent(),
        SES_SEND_ENABLED:   Match.absent(),
      });
    });

    it('sets SES_RECEIVING_MODE to the configured receiving mode', () => {
      const template = synthBootstrap({ sesReceivingMode: 'forced' });

      hasEnvironment(template, { SES_RECEIVING_MODE: 'forced' });
    });

    it('sets SES_SEND_ENABLED to on when sending is enabled', () => {
      const template = synthBootstrap({ sesSendEnabled: true });

      hasEnvironment(template, { SES_SEND_ENABLED: 'on' });
    });
  });

  describe('grants', () => {
    it('grants exactly DynamoDbActions.readWrite, Allow, on the auth-key-store table and its indexes', () => {
      const template = synthBootstrap();

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectEquals({
              Action:   Match.arrayEquals([...DynamoDbActions.readWrite]),
              Effect:   'Allow',
              Resource: stack.resolve([authKeyStoreTable.tableArn, `${authKeyStoreTable.tableArn}/index/*`]),
            }),
          ]),
        },
      });
    });

    it('allows creating only the Service Quotas service-linked role', () => {
      const template = synthBootstrap();

      hasStatement(template, {
        Action:    'iam:CreateServiceLinkedRole',
        Resource:  '*',
        Condition: { StringEquals: { 'iam:AWSServiceName': 'servicequotas.amazonaws.com' } },
      });
    });

    it('scopes execute-api:Invoke to the bootstrap, grant-resource and revoke-resource paths of the vendor account', () => {
      const template = synthBootstrap();

      hasStatement(template, {
        Action:   'execute-api:Invoke',
        Resource: [
          `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/bootstrap`,
          `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/grant-resource`,
          `arn:aws:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/revoke-resource`,
        ],
      });
    });

    it('grants rule set activation and description without conditions', () => {
      const template = synthBootstrap();

      hasStatement(template, {
        Action:    ['ses:SetActiveReceiptRuleSet', 'ses:DescribeActiveReceiptRuleSet'],
        Resource:  '*',
        Condition: Match.absent(),
      });
    });

    it('grants record management on the hosted zone when one is given', () => {
      const hostedZone = HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: 'Z0123456789', zoneName: 'example.com' });
      const template   = synthBootstrap({ hostedZone });

      hasStatement(template, {
        Action:   ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone'],
        Resource: 'arn:aws:route53:::hostedzone/Z0123456789',
      });
    });

    it('grants no Route53 access when no hosted zone is given', () => {
      const template = synthBootstrap();

      expect(statementsForAction(template, 'route53:ChangeResourceRecordSets')).toHaveLength(0);
    });

    it('scopes SES identity registration to the domain identity', () => {
      const template = synthBootstrap();

      hasStatement(template, {
        Action:   ['ses:CreateEmailIdentity', 'ses:GetEmailIdentity', 'ses:PutEmailIdentityDkimSigningAttributes'],
        Resource: identityArn('example.com'),
      });
    });

    it('allows describing only the stack the Lambda is deployed in', () => {
      const template = synthBootstrap();

      hasStatement(template, {
        Action:    'cloudformation:DescribeStacks',
        Resource:  { Ref: 'AWS::StackId' },
        Condition: Match.absent(),
      });
    });

    it('scopes ses:TagResource to the domain identity with one statement for a request carrying the root stack id and one for a request carrying only its name', () => {
      const template = synthBootstrap();
      const tagKeys  = { 'aws:TagKeys': [ServerlessInboxTagKeys.rootStack, ServerlessInboxTagKeys.rootStackId] };

      hasStatement(template, {
        Action:    'ses:TagResource',
        Resource:  identityArn('example.com'),
        Condition: Match.objectEquals({
          StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: stack.resolve(StackIdentity.guid) },
          'ForAllValues:StringEquals': tagKeys,
        }),
      });
      hasStatement(template, {
        Action:    'ses:TagResource',
        Resource:  identityArn('example.com'),
        Condition: Match.objectEquals({
          StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: 'TestStack' },
          Null:                        { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: 'true' },
          'ForAllValues:StringEquals': tagKeys,
        }),
      });
    });
  });
});
