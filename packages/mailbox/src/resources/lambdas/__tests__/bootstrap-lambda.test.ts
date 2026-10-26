/// <reference types="jest" />

/**
 * BootstrapLambda wrapper tests.
 *
 * The environment variable names asserted here are written as literals on purpose: the Lambda
 * runtime reads them, so a rename in the wrapper must fail these tests. The optional SES
 * variables must be absent unless their prop is set, and every IAM statement the wrapper
 * grants is pinned to the scope it is meant to have.
 */

import type { IArtifactResolver }                                                    from '@serverlessinbox/artifact-registry-cdk';
import { statementsForAction }                                                       from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { VENDOR_ACCOUNT_ID, ServerlessInboxTagKeys, StackIdentity }                  from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                                           from 'aws-cdk-lib/assertions';
import { ReceiptRuleSet }                                                            from 'aws-cdk-lib/aws-ses';
import * as cdk                                                                      from 'aws-cdk-lib';

import { SesReceivingMode }                                                          from '../../../contracts/ses-receiving-mode';
import type { IDnsZone }                                                             from '../../../core/edge/dns-zone';
import { BootstrapLambda }                                                           from '../bootstrap-lambda';
import type { BootstrapLambdaProps }                                                 from '../bootstrap-lambda';

import { expectGrantedOnceTo, fakeAuthKeyStoreTable, fakeDataTable }                 from './lambda-wrapper-fakes';
import { arrangeWrapperStack }                                                       from './lambda-wrapper-helpers';

describe('BootstrapLambda', () => {
  let stack: cdk.Stack;
  let artifactResolver: IArtifactResolver;
  let configTable: ReturnType<typeof fakeDataTable>;
  let authKeyStoreTable: ReturnType<typeof fakeAuthKeyStoreTable>;
  let sesRuleSet: ReceiptRuleSet;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;
    artifactResolver  = arrangement.artifactResolver;

    configTable       = fakeDataTable('config-table');
    authKeyStoreTable = fakeAuthKeyStoreTable('auth-key-store');
    sesRuleSet        = new ReceiptRuleSet(stack, 'ses-rule-set', {});
  });

  function newBootstrap(overrides: Partial<BootstrapLambdaProps> = {}): BootstrapLambda {
    return new BootstrapLambda(stack, 'bootstrap', {
      timeout: cdk.Duration.seconds(45),
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet,
      vendorLink: { vendorAccountIds: [VENDOR_ACCOUNT_ID], stackIdentityTagKey: ServerlessInboxTagKeys.rootStack },
      ...overrides,
    });
  }

  function synthBootstrap(overrides: Partial<BootstrapLambdaProps> = {}): Template {
    newBootstrap(overrides);

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
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, `:identity/${identity}`]],
    };
  }

  function executeApiArn(path: string): unknown {
    return { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:${path}`]] };
  }

  function rootStackId(): unknown {
    return stack.resolve(StackIdentity.guid);
  }

  it('runs for the timeout it is given', () => {
    const template = synthBootstrap();

    template.hasResourceProperties('AWS::Lambda::Function', { Timeout: 45 });
  });

  describe('environment', () => {
    it('sets the table names, the stack identity and the SES rule set name', () => {
      const template = synthBootstrap();

      hasEnvironment(template, {
        CONFIG_TABLE_NAME:         'config-table',
        AUTH_KEY_STORE_TABLE_NAME: 'auth-key-store',
        STACK_IDENTITY_TAG_VALUE:  { Ref: 'AWS::StackName' },
        STACK_IDENTITY_TAG_KEY:    ServerlessInboxTagKeys.rootStack,
        SES_RULE_SET_NAME:         stack.resolve(sesRuleSet.receiptRuleSetName),
      });
    });

    it('sets ROOT_STACK_ID to the stack guid', () => {
      const template = synthBootstrap();

      hasEnvironment(template, { ROOT_STACK_ID: rootStackId() });
    });

    it('omits SES_RECEIVING_MODE and SES_SEND_ENABLED when their props are not set', () => {
      const template = synthBootstrap();

      hasEnvironment(template, {
        SES_RECEIVING_MODE: Match.absent(),
        SES_SEND_ENABLED:   Match.absent(),
      });
    });

    it.each([
      [SesReceivingMode.OFF, 'off'],
      [SesReceivingMode.ON, 'on'],
      [SesReceivingMode.FORCED, 'forced'],
    ])('sets SES_RECEIVING_MODE to %s when the configured receiving mode is %s', (mode, wireValue) => {
      const template = synthBootstrap({ sesReceivingMode: mode });

      hasEnvironment(template, { SES_RECEIVING_MODE: wireValue });
    });

    it('sets SES_SEND_ENABLED to on when sending is enabled', () => {
      const template = synthBootstrap({ sesSendEnabled: true });

      hasEnvironment(template, { SES_SEND_ENABLED: 'on' });
    });
  });

  describe('grants', () => {
    it('requests read-write on the auth-key-store table for itself', () => {
      const bootstrap = newBootstrap();

      expectGrantedOnceTo(authKeyStoreTable.grantReadWrite, bootstrap);
    });

    it('requests read-write on the config table for itself', () => {
      const bootstrap = newBootstrap();

      expectGrantedOnceTo(configTable.grantReadWrite, bootstrap);
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
          executeApiArn('*/*/POST/bootstrap'),
          executeApiArn('*/*/POST/grant-resource'),
          executeApiArn('*/*/POST/revoke-resource'),
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

    it('has the hosted zone it is given grant it record management', () => {
      const dnsZone: IDnsZone = { hostedZoneId: 'Z0123456789', grantRecordManagement: jest.fn() };
      const bootstrap         = newBootstrap({ dnsZone });

      expect(dnsZone.grantRecordManagement).toHaveBeenCalledWith(bootstrap);
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
          StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: rootStackId() },
          'ForAllValues:StringEquals': tagKeys,
        }),
      });
      hasStatement(template, {
        Action:    'ses:TagResource',
        Resource:  identityArn('example.com'),
        Condition: Match.objectEquals({
          StringEquals:                { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' } },
          Null:                        { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: 'true' },
          'ForAllValues:StringEquals': tagKeys,
        }),
      });
    });
  });
});
