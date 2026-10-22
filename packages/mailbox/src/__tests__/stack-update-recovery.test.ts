/// <reference types="jest" />

/**
 * StackUpdateAddon IAM and configuration testing.
 *
 * After the security hardening to remove changeset execution capability:
 * - No recovery workflow or EventBridge rule
 * - No state machine ARN env var
 * - No states:* or rollback-recovery grants on the Lambda
 * - No cloudformation:ExecuteChangeSet permission
 *
 * Builds `StackUpdateAddon` under a real `cdk.Stack` (with an explicit `env`, matching the
 * standalone build-tool synth shape that bakes `Stack.of(this).account/.region` into a literal —
 * see `cdk-construct-pattern` skill) and asserts against the SYNTHESIZED TEMPLATE, never the
 * construct, per `unit-testing`/`iam-scoping`.
 */

import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                          from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, resourcesOf, statementsForRole } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                  from 'aws-cdk-lib/assertions';
import * as dynamodb                                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }             from 'aws-cdk-lib';

import { StackUpdateAddon }                          from '../platform/update/stack-update-addon';
import { DataTable }                                 from '../resources/tables/data-tables';
import { AuditEventsQueue }                          from '../resources/queues/audit-events-queue';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION  = 'us-west-2';

function buildTemplate(): Template {
  const app   = new App();
  const stack = new cdk.Stack(app, 'TestStackUpdateRecovery', {
    env:         { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const packages: Record<string, ArtifactPin> = {
    'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  const artifactResolver                      = new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });

  const configTable      = new DataTable(dynamodb.Table.fromTableArn(
    stack,
    'config-table',
    `arn:aws:dynamodb:${TEST_REGION}:${TEST_ACCOUNT}:table/config`,
  ));
  const auditEventsQueue = new AuditEventsQueue(stack, 'audit-queue');

  new StackUpdateAddon(stack, 'stack-update-addon', {
    configTable,
    auditEventsQueue,
    artifactResolver,
    templateName:    'mailbox-standard',
    templateVersion: '1.0.0',
  });

  // Template.fromStack synthesizes the stack; a genuine CFN circular dependency between the
  // Lambda and the state machine throws here (proves the name-based cycle-break works).
  return Template.fromStack(stack);
}

describe('StackUpdateAddon: security hardening (no execution capability)', () => {
  let template: Template;

  beforeAll(() => {
    template = buildTemplate();
  });

  function stackUpdateLambda(): { logicalId: string; resource: any } {
    const fns     = template.findResources('AWS::Lambda::Function');
    const entries = Object.entries(fns).filter(
      ([, fn]: [string, any]) => fn.Properties?.Environment?.Variables?.CONFIG_TABLE_NAME &&
                                  !fn.Properties?.Environment?.Variables?.STACK_UPDATE_STATE_MACHINE_ARN,
    );
    expect(entries).toHaveLength(1);
    const [logicalId, resource] = entries[0];
    return { logicalId, resource };
  }

  it('no Step Functions state machine is created', () => {
    const machines = template.findResources('AWS::StepFunctions::StateMachine');
    expect(Object.keys(machines)).toHaveLength(0);
  });

  it('no EventBridge rule for UPDATE_ROLLBACK_FAILED is created', () => {
    const rules     = template.findResources('AWS::Events::Rule');
    const rulesList = Object.values(rules) as any[];

    const rollbackRules = rulesList.filter((rule) =>
      rule.Properties?.EventPattern?.detail?.['status-details']?.status?.includes('UPDATE_ROLLBACK_FAILED'),
    );
    expect(rollbackRules).toHaveLength(0);
  });

  it('Lambda does not have STACK_UPDATE_STATE_MACHINE_ARN env var', () => {
    const { resource } = stackUpdateLambda();
    expect(resource.Properties.Environment.Variables.STACK_UPDATE_STATE_MACHINE_ARN).toBeUndefined();
  });

  it('Lambda does not have cloudformation:ExecuteChangeSet permission', () => {
    const { resource }  = stackUpdateLambda();
    const roleArnRef    = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const allStatements = statementsForRole(template, roleLogicalId);

    for (const stmt of allStatements) {
      const actions = actionsOf(stmt);
      expect(actions).not.toContain('cloudformation:ExecuteChangeSet');
    }
  });

  it('Lambda does not have states:* or states:StartExecution/ListExecutions permissions', () => {
    const { resource }  = stackUpdateLambda();
    const roleArnRef    = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const allStatements = statementsForRole(template, roleLogicalId);

    for (const stmt of allStatements) {
      const actions = actionsOf(stmt);
      expect(actions).not.toContain('states:StartExecution');
      expect(actions).not.toContain('states:ListExecutions');
      expect(actions).not.toContain('states:DescribeExecution');
      expect(actions).not.toContain('states:*');
    }
  });

  it('Lambda does not have cloudformation:ContinueUpdateRollback or rollback-recovery actions', () => {
    const { resource }  = stackUpdateLambda();
    const roleArnRef    = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const allStatements = statementsForRole(template, roleLogicalId);

    const forbiddenActions = [
      'cloudformation:ContinueUpdateRollback',
      'cloudformation:DescribeStackResource',
      'cloudformation:DescribeStackResources',
    ];

    for (const stmt of allStatements) {
      const actions = actionsOf(stmt);
      for (const forbidden of forbiddenActions) {
        expect(actions).not.toContain(forbidden);
      }
    }
  });

  it('Lambda has ChangeSe permissions scoped to root stack ARN (no ExecuteChangeSet)', () => {
    const { resource }  = stackUpdateLambda();
    const roleArnRef    = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const allStatements = statementsForRole(template, roleLogicalId);

    const changesetStmt = allStatements.find((s) => {
      const actions = actionsOf(s);
      return actions.includes('cloudformation:CreateChangeSet');
    });
    expect(changesetStmt).toBeDefined();
    expect(changesetStmt!.Action).toEqual(
      expect.arrayContaining([
        'cloudformation:CreateChangeSet',
        'cloudformation:DescribeChangeSet',
        'cloudformation:DeleteChangeSet',
        'cloudformation:ListChangeSets',
        'cloudformation:DescribeStacks',
        'cloudformation:GetTemplate',
      ]),
    );
    // Must NOT have ExecuteChangeSet
    expect(changesetStmt!.Action).not.toContain('cloudformation:ExecuteChangeSet');
    // Scoped to root stack, never wildcard
    const resources = resourcesOf(changesetStmt!);
    expect(resources).toEqual([{ Ref: 'AWS::StackId' }]);
  });

  it('Lambda has no iam:* or lambda:* or service wildcard permissions', () => {
    const { resource }  = stackUpdateLambda();
    const roleArnRef    = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const allStatements = statementsForRole(template, roleLogicalId);

    for (const stmt of allStatements) {
      const actions   = actionsOf(stmt);
      const resources = resourcesOf(stmt);

      // No service wildcards like lambda:*, dynamodb:*, etc.
      for (const action of actions) {
        if (action.includes('*')) {
          // Only s3:GetObject is allowed with wildcards in the prefix path
          expect(action).not.toMatch(/^(iam|lambda|dynamodb|sqs|ses|cognito-idp|cloudfront|apigateway|logs|events|acm|route53|states|resource-groups|sns):\*/);
        }
      }

      // No resources: ['*'] for these service operations
      for (const action of actions) {
        if (action.startsWith('iam:') || action.startsWith('lambda:') || action.startsWith('dynamodb:')) {
          expect(resources).not.toContain('*');
        }
      }
    }
  });
});
