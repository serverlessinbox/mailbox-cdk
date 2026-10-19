/// <reference types="jest" />

/**
 * Mailbox: explicitly named resources that survive a move of the construct.
 *
 * Moving `Mailbox` to another position in the tree changes every logical ID beneath it, so
 * CloudFormation creates the replacements before deleting the originals. A resource with an explicit
 * physical name that renders identically before and after the move makes that create fail with
 * "already exists" (a retained original keeps its name). This suite synthesizes the same Mailbox
 * directly under the stack and under an extra intermediate construct, and lists every resource whose
 * explicit name is identical in both. Each entry is `<resource type>|<name property>|<rendered name>`,
 * which does not depend on logical IDs.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';
import { CloudFormationResource } from './iam-test-helpers';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages: {
    'mailbox-go': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

/** The template properties CloudFormation uses as a resource's physical name. */
const PHYSICAL_NAME_KEYS = ['TableName', 'QueueName', 'BucketName', 'FunctionName', 'RoleName', 'StateMachineName', 'LogGroupName', 'Name'];

/** API Gateway names are display labels that CloudFormation does not require to be unique. */
const DISPLAY_NAME_TYPES = ['AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Authorizer'];

/**
 * The resources whose explicit name does not change when Mailbox moves. The relocation fix shrinks
 * this list to the names that are intentionally fixed.
 */
const EXPECTED_OFFENDERS: string[] = [
  `AWS::DynamoDB::Table|TableName|{"Fn::Join":["",[{"Ref":"AWS::AccountId"},"-",{"Ref":"AWS::StackName"},"-auth-key-store"]]}`,
  `AWS::DynamoDB::Table|TableName|{"Fn::Join":["",[{"Ref":"AWS::AccountId"},"-",{"Ref":"AWS::StackName"},"-websocket"]]}`,
  `AWS::IAM::Role|RoleName|{"Fn::Join":["",["mailbox-diag-role-stack-failure-detection-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::IAM::Role|RoleName|{"Fn::Join":["",["mailbox-sweeper-exec-ops-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]]}`,
  `AWS::IAM::Role|RoleName|{"Fn::Join":["",["mailbox-sweeper-worker-ops-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]]}`,
  `AWS::Lambda::Function|FunctionName|{"Fn::Join":["",["mailbox-diag-fn-stack-failure-detection-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/admin-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/audit-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/infra-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/jmap-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/mail-in-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::Logs::LogGroup|LogGroupName|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/mail-out-",{"Fn::Select":[0,{"Fn::Split":["-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]}]}]]}`,
  `AWS::ResourceGroups::Group|Name|{"Fn::Join":["",[{"Ref":"AWS::StackName"},"-serverless-inbox"]]}`,
  `AWS::SES::ConfigurationSet|Name|"123456789012-testrelocation-ses-config"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-audit-events"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-audit-events-dlq"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-email-processing-dlq"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-email-processing-queue"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-email-submissions"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-email-submissions-dlq"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-ses-notifications-queue"`,
  `AWS::SQS::Queue|QueueName|"123456789012-testrelocation-tantivy-indexing-schedule-dlq"`,
  `AWS::SSM::Parameter|Name|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/data-override/auditLogTable"]]}`,
  `AWS::SSM::Parameter|Name|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/data-override/changelogTable"]]}`,
  `AWS::SSM::Parameter|Name|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/data-override/configTable"]]}`,
  `AWS::SSM::Parameter|Name|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/data-override/itemTable"]]}`,
  `AWS::SSM::Parameter|Name|{"Fn::Join":["",["/serverlessinbox/",{"Ref":"AWS::StackName"},"/data-override/mailFeedbackTable"]]}`,
  `AWS::StepFunctions::StateMachine|StateMachineName|{"Fn::Join":["",["mailbox-data-deployer-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]]}`,
  `AWS::StepFunctions::StateMachine|StateMachineName|{"Fn::Join":["",["mailbox-edge-deployer-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]]}`,
  `AWS::StepFunctions::StateMachine|StateMachineName|{"Fn::Join":["",["mailbox-sweeper-ops-",{"Fn::Select":[2,{"Fn::Split":["/",{"Ref":"AWS::StackId"}]}]}]]}`,
];

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    },
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function explicitNamesAfterSynth(underIntermediateConstruct: boolean): Set<string> {
  const app = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  const stack = new cdk.Stack(app, 'TestRelocation', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const parent = underIntermediateConstruct ? new Construct(stack, 'moved') : stack;
  new Mailbox(parent, 'mailbox', { authProvider: createMockAuthProvider() });

  const resources = (Template.fromStack(stack).toJSON() as { Resources: Record<string, CloudFormationResource> }).Resources;
  const names = new Set<string>();
  for (const resource of Object.values(resources)) {
    if (DISPLAY_NAME_TYPES.includes(resource.Type)) {
      continue;
    }
    for (const key of PHYSICAL_NAME_KEYS) {
      const name = resource.Properties?.[key];
      if (name !== undefined) {
        names.add(`${resource.Type}|${key}|${JSON.stringify(name)}`);
      }
    }
  }
  return names;
}

describe('Mailbox moved under an intermediate construct', () => {
  it('lists the resources whose explicit name does not change', () => {
    const before = explicitNamesAfterSynth(false);
    const after = explicitNamesAfterSynth(true);

    const offenders = [...before].filter((name) => after.has(name)).sort();

    expect(offenders).toEqual(EXPECTED_OFFENDERS);
  });
});
