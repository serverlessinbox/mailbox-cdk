/**
 * BootstrapLambda SES rule set env var tests.
 *
 * The SES rule set always exists (SesRules is constructed unconditionally), so its name must
 * always be passed to the bootstrap Lambda via SES_RULE_SET_NAME. Whether the rule set is
 * actually *activated* is a separate, genuinely-optional concern controlled by
 * SES_RECEIVING_MODE, which must be absent unless a receiving mode was explicitly configured.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ses from 'aws-cdk-lib/aws-ses';
import { PinnedResolver, CdkArtifactEngine, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { BootstrapLambda } from '../lambdas/bootstrap';
import { AuthKeyStoreTable, type IAuthKeyStoreTable } from '../features/auth-key-store/auth-key-store-table';
import { DataTable, type IDataTable } from '../data/data-tables';

describe('BootstrapLambda SES rule set wiring', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;
  let configTable: IDataTable;
  let authKeyStoreTable: IAuthKeyStoreTable;
  let ruleSet: ses.IReceiptRuleSet;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
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
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-cdk', 'mailbox-go']);
    artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);

    configTable = new DataTable(new dynamodb.Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    }));
    authKeyStoreTable = new AuthKeyStoreTable(stack, 'auth-key-store-table');

    ruleSet = new ses.ReceiptRuleSet(stack, 'rule-set');
  });

  it('sets SES_RULE_SET_NAME and omits SES_RECEIVING_MODE when no receiving mode is configured', () => {
    new BootstrapLambda(stack, 'bootstrap', {
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet: ruleSet,
      vendorAccountIds: ['123456789012'],
      stackIdentityTagKey: 'serverless-inbox:root-stack',
    });

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { Type: string; Properties?: { Environment?: { Variables?: Record<string, unknown> } } }>;
    const fn = Object.values(resources).find((r) => r.Type === 'AWS::Lambda::Function');
    expect(fn).toBeDefined();
    const vars = fn?.Properties?.Environment?.Variables ?? {};
    expect(vars['SES_RULE_SET_NAME']).toBeDefined();
    expect(vars['SES_RECEIVING_MODE']).toBeUndefined();
  });

  it('sets both SES_RULE_SET_NAME and SES_RECEIVING_MODE when a receiving mode is configured', () => {
    new BootstrapLambda(stack, 'bootstrap', {
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet: ruleSet,
      sesReceivingMode: 'on',
      vendorAccountIds: ['123456789012'],
      stackIdentityTagKey: 'serverless-inbox:root-stack',
    });

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { Type: string; Properties?: { Environment?: { Variables?: Record<string, unknown> } } }>;
    const fn = Object.values(resources).find((r) => r.Type === 'AWS::Lambda::Function');
    expect(fn).toBeDefined();
    const vars = fn?.Properties?.Environment?.Variables ?? {};
    expect(vars['SES_RULE_SET_NAME']).toBeDefined();
    expect(vars['SES_RECEIVING_MODE']).toBe('on');
  });

  it('sets STACK_IDENTITY_TAG_KEY to ServerlessInboxTagKeys.rootStack', () => {
    new BootstrapLambda(stack, 'bootstrap', {
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet: ruleSet,
      vendorAccountIds: ['123456789012'],
      stackIdentityTagKey: 'serverless-inbox:root-stack',
    });

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { Type: string; Properties?: { Environment?: { Variables?: Record<string, unknown> } } }>;
    const fn = Object.values(resources).find((r) => r.Type === 'AWS::Lambda::Function');
    expect(fn).toBeDefined();
    const vars = fn?.Properties?.Environment?.Variables ?? {};
    expect(vars['STACK_IDENTITY_TAG_KEY']).toBe(ServerlessInboxTagKeys.rootStack);
  });

  it('scopes ses:TagResource to its own statement gated by RequestTag and TagKeys', () => {
    new BootstrapLambda(stack, 'bootstrap', {
      configTable,
      authKeyStoreTable,
      artifactResolver,
      domain: 'example.com',
      sesRuleSet: ruleSet,
      vendorAccountIds: ['123456789012'],
      stackIdentityTagKey: 'serverless-inbox:root-stack',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:TagResource',
            Resource: {
              'Fn::Join': [
                '',
                [
                  'arn:aws:ses:',
                  { Ref: 'AWS::Region' },
                  ':',
                  { Ref: 'AWS::AccountId' },
                  ':identity/example.com',
                ],
              ],
            },
            Condition: {
              StringEquals: {
                'aws:RequestTag/serverless-inbox:root-stack': 'TestStack',
              },
              'ForAllValues:StringEquals': {
                'aws:TagKeys': ['serverless-inbox:root-stack'],
              },
            },
          }),
        ]),
      },
    });
  });
});
