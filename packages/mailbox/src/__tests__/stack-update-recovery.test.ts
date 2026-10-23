/// <reference types="jest" />

/**
 * StackUpdateAddon IAM grants on its Lambda, read from the synthesized template.
 *
 * The update Lambda may create and inspect change sets of the root stack, scoped to `AWS::StackId`.
 * It must never be able to execute a change set, roll a stack back, or start a state machine: a
 * grant that adds any of those actions fails the forbidden-action case below. Builds the addon under
 * a real `cdk.Stack` with an explicit `env`, so the template is the one a standalone build ships.
 */

import { ArtifactZone, PinnedArtifactResolver }      from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                          from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, resourcesOf, statementsForRole } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                  from 'aws-cdk-lib/assertions';
import * as dynamodb                                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                      from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }             from 'aws-cdk-lib';
import * as t                                        from 'typanion';

import { StackUpdateAddon }                          from '../platform/update/stack-update-addon';
import { AuditEventsQueue }                          from '../resources/queues/audit-events-queue';
import { DataTable }                                 from '../resources/tables/data-tables';

import { isTemplateValue, resourcesOfType }          from './template-resources';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION  = 'us-west-2';

const isRoleReference = t.isObject({
  'Fn::GetAtt': t.isTuple([t.isString(), t.isString()]),
});

const isUpdateLambdaProperties = t.isPartial({
  Role:        isRoleReference,
  Environment: t.isOptional(t.isPartial({ Variables: t.isOptional(t.isDict(isTemplateValue)) })),
});

/** Actions that let the update Lambda execute, roll back or drive a state machine. None may be granted. */
const FORBIDDEN_ACTIONS = [
  'cloudformation:ExecuteChangeSet',
  'cloudformation:ContinueUpdateRollback',
  'cloudformation:DescribeStackResource',
  'cloudformation:DescribeStackResources',
  'states:StartExecution',
  'states:ListExecutions',
  'states:DescribeExecution',
  'states:*',
];

/** Service-wide wildcards: an action of any of these services must name the action it grants. */
const FORBIDDEN_SERVICE_WILDCARD = /^(iam|lambda|dynamodb|sqs|ses|cognito-idp|cloudfront|apigateway|logs|events|acm|route53|states|resource-groups|sns):\*/;

const CHANGESET_ACTIONS = [
  'cloudformation:CreateChangeSet',
  'cloudformation:DescribeChangeSet',
  'cloudformation:DeleteChangeSet',
  'cloudformation:ListChangeSets',
  'cloudformation:DescribeStacks',
  'cloudformation:GetTemplate',
];

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

describe('StackUpdateAddon Lambda grants', () => {
  let template: Template;

  beforeAll(() => {
    template = buildTemplate();
  });

  /** The update Lambda: the one function whose environment names the config table. */
  function updateLambda() {
    const functions = resourcesOfType(template, 'AWS::Lambda::Function', isUpdateLambdaProperties)
      .filter((fn) => fn.properties.Environment?.Variables?.CONFIG_TABLE_NAME !== undefined);
    expect(functions).toHaveLength(1);
    const [fn] = functions;
    return fn;
  }

  /** Every statement of the update Lambda's role, with the role resolved from its template reference. */
  function roleStatements() {
    const role = updateLambda().properties.Role;
    if (role === undefined) {
      throw new Error('The update Lambda has no Role reference');
    }
    const [roleLogicalId] = role['Fn::GetAtt'];
    return statementsForRole(template, roleLogicalId);
  }

  it('grants the change-set operations on the root stack only', () => {
    const changeSet = roleStatements().find((statement) => actionsOf(statement).includes('cloudformation:CreateChangeSet'));
    if (changeSet === undefined) {
      throw new Error('no statement grants cloudformation:CreateChangeSet');
    }

    expect(actionsOf(changeSet)).toEqual(expect.arrayContaining(CHANGESET_ACTIONS));
    expect(resourcesOf(changeSet)).toEqual([{ Ref: 'AWS::StackId' }]);
  });

  it('grants none of the execution, rollback or state machine actions', () => {
    const granted = roleStatements().flatMap((statement) => actionsOf(statement));

    expect(FORBIDDEN_ACTIONS.filter((action) => granted.includes(action))).toEqual([]);
  });

  it('grants no service-wide wildcard action', () => {
    const granted = roleStatements().flatMap((statement) => actionsOf(statement));

    expect(granted.filter((action) => FORBIDDEN_SERVICE_WILDCARD.test(action))).toEqual([]);
  });

  it('never scopes an iam, lambda or dynamodb action to every resource', () => {
    const starred = roleStatements().filter((statement) =>
      resourcesOf(statement).includes('*') && actionsOf(statement).some((action) => /^(iam|lambda|dynamodb):/.test(action)));

    expect(starred).toEqual([]);
  });
});
