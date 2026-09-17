/// <reference types="jest" />

/**
 * stack-update-resilience plan, increment 2: the CDK side of root-stack `UPDATE_ROLLBACK_FAILED`
 * recovery — the `StackUpdateAddon`'s recovery workflow (Step Functions) and EventBridge rule.
 *
 * Builds `StackUpdateAddon` under a real `cdk.Stack` (with an explicit `env`, matching the
 * standalone build-tool synth shape that bakes `Stack.of(this).account/.region` into a literal —
 * see `cdk-construct-pattern` skill) and asserts against the SYNTHESIZED TEMPLATE, never the
 * construct, per `unit-testing`/`iam-scoping`.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { StackUpdateAddon } from '../addons/stack-update/stack-update-addon';
import { getPolicyStatements } from './iam-test-helpers';
import { AuditEventsQueue } from '../features/audit-writing/audit-events-queue';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-west-2';

/** Flattens a state machine's `DefinitionString` intrinsic into a single searchable string —
 * state NAMES are always literal, so they survive in one of the literal chunks either side of a
 * token (same technique as `mailbox-sweeper-removal-wiring.test.ts`). */
function flattenDefinition(definitionString: unknown): string {
  const obj = definitionString as { 'Fn::Join'?: [string, unknown[]] } | string;
  if (typeof obj === 'string') return obj;
  const parts = obj?.['Fn::Join']?.[1] ?? [];
  return parts.filter((p): p is string => typeof p === 'string').join('');
}

function buildTemplate(): Template {
  const app = new App({
    context: {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-go': { kind: 'release', version: '1.0.0' },
        },
      },
    },
  });
  const stack = new cdk.Stack(app, 'TestStackUpdateRecovery', {
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const packages: Record<string, ArtifactVersionsEntry> = {
    'mailbox-go': { version: '1.0.0', zone: 'regional' },
  };
  const artifactResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
  artifactResolver.registerPackages(['mailbox-go']);

  const configTable = dynamodb.Table.fromTableArn(
    stack,
    'config-table',
    `arn:aws:dynamodb:${TEST_REGION}:${TEST_ACCOUNT}:table/config`,
  );
  const auditEventsQueue = new AuditEventsQueue(stack, 'audit-queue');

  new StackUpdateAddon(stack, 'stack-update-addon', {
    configTable,
    auditEventsQueue,
    artifactResolver,
    templateName: 'mailbox-standard',
    templateVersion: '1.0.0',
  });

  // Template.fromStack synthesizes the stack; a genuine CFN circular dependency between the
  // Lambda and the state machine throws here (proves the name-based cycle-break works).
  return Template.fromStack(stack);
}

describe('StackUpdateAddon: rollback-recovery workflow', () => {
  let template: Template;

  beforeAll(() => {
    template = buildTemplate();
  });

  function stateMachine(): any {
    const machines = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
    expect(machines).toHaveLength(1);
    return machines[0];
  }

  function lambdaFunction(): { logicalId: string; resource: any } {
    const fns = template.findResources('AWS::Lambda::Function');
    const entries = Object.entries(fns).filter(
      ([, fn]: [string, any]) => fn.Properties?.Environment?.Variables?.STACK_UPDATE_STATE_MACHINE_ARN,
    );
    expect(entries).toHaveLength(1);
    const [logicalId, resource] = entries[0];
    return { logicalId, resource };
  }

  it('the EventBridge rule matches only aws.cloudformation UPDATE_ROLLBACK_FAILED for this root stack, and targets the Lambda', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const entries = Object.values(rules);
    expect(entries).toHaveLength(1);
    const rule = entries[0] as any;

    expect(rule.Properties.EventPattern.source).toEqual(['aws.cloudformation']);
    expect(rule.Properties.EventPattern['detail-type']).toEqual(['CloudFormation Stack Status Change']);
    expect(rule.Properties.EventPattern.detail).toEqual({
      'stack-id': [{ Ref: 'AWS::StackId' }],
      'status-details': { status: ['UPDATE_ROLLBACK_FAILED'] },
    });

    const { logicalId } = lambdaFunction();
    const targetArns = rule.Properties.Targets.map((t: any) => JSON.stringify(t.Arn));
    expect(targetArns.some((arn: string) => arn.includes(logicalId))).toBe(true);

    // The rule must never target the state machine directly (no execution-name field on Target).
    const sm = stateMachine();
    const smLogicalId = Object.keys(template.findResources('AWS::StepFunctions::StateMachine'))[0];
    expect(targetArns.some((arn: string) => arn.includes(smLogicalId))).toBe(false);
    void sm;
  });

  it('the state machine definition has the Wait/check/recover/Choice($.next) shape, no bounds logic of its own', () => {
    const sm = stateMachine();
    const def = flattenDefinition(sm.Properties.DefinitionString);

    for (const stateName of ['"init"', '"wait"', '"check"', '"recover"', '"choice-after-check"', '"choice-after-recover"', '"succeed"', '"fail"']) {
      expect(def).toContain(stateName);
    }

    // Payload shape per the contract: {"mode":"check","state":<$.state>} / {"mode":"recover", ...}.
    expect(def).toContain('"mode":"check"');
    expect(def).toContain('"mode":"recover"');

    // Choice routing keys off $.next, not any locally-tracked attempt/iteration counter.
    expect(def).toContain('"Variable":"$.next"');
    expect(def).toContain('"StringEquals":"wait"');
    expect(def).toContain('"StringEquals":"recover"');
    expect(def).toContain('"StringEquals":"succeed"');

    // No attempt-bound or iteration-bound arithmetic (e.g. States.MathAdd, as the stack-deployer
    // workflow uses for ITS attempt counter) — bounds are Go's job per the plan.
    expect(def).not.toContain('States.MathAdd');

    // `init` copies episodeStartedAt into state alongside the other contract fields.
    expect(def).toContain('episodeStartedAt');
  });

  it('the hard wall-clock cap is 13 hours (46800s), independent of Go\'s ~12h bound', () => {
    // The state machine's execution timeout is a top-level ASL field embedded in DefinitionString
    // (not a separate CFN "Properties.TimeoutSeconds" field) — flatten and search, same technique
    // as the shape test above.
    const sm = stateMachine();
    const def = flattenDefinition(sm.Properties.DefinitionString);
    expect(def).toContain('"TimeoutSeconds":46800');
  });

  it('check and recover both have Retry and a Catch routing to wait, preserving $.state', () => {
    // Retry/Catch blocks reference no dynamic (token) values, so they survive intact as literal
    // text in the flattened definition — same technique as the shape test above, applied to the
    // per-task ASL fragments rather than the whole definition.
    const sm = stateMachine();
    const def = flattenDefinition(sm.Properties.DefinitionString);

    // A States.ALL Retry with BackoffRate 2 appears (task-failure retry, on top of LambdaInvoke's
    // own default Lambda-service-exception retry block, which is untouched).
    expect(def).toContain('"ErrorEquals":["States.ALL"]');
    expect(def).toContain('"BackoffRate":2');

    // A Catch-all routes to "wait" with a ResultPath that is NOT "$" (so $.state survives) —
    // ResultPath appears as "$.lastError", distinct from the default-resultPath LambdaInvoke
    // success path (which carries no ResultPath field at all).
    expect(def).toContain('"Catch"');
    expect(def).toContain('"ResultPath":"$.lastError"');

    // Each Catch's Next points back at "wait" (verified indirectly: "wait" is the only state name
    // reachable from a Catch — no other Next/Catch target besides the Choice-driven success path).
    // Exactly two Catch blocks: one on "check", one on "recover".
    const catchBlockMatches = def.match(/"Catch":\[\{[^]*?"Next":"([^"]+)"/g) ?? [];
    expect(catchBlockMatches).toHaveLength(2);
    for (const block of catchBlockMatches) {
      expect(block).toContain('"Next":"wait"');
    }
  });

  it('the state machine role holds only lambda:InvokeFunction, scoped to the stack-update-api function', () => {
    const sm = stateMachine();
    const roleArnRef = sm.Properties.RoleArn as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const policies = template.findResources('AWS::IAM::Policy');
    const attachedToRole = Object.values(policies).filter((p: any) =>
      (p.Properties?.Roles ?? []).some((r: any) => r?.Ref === roleLogicalId),
    );
    expect(attachedToRole).toHaveLength(1);

    const statements = getPolicyStatements(attachedToRole[0].Properties.PolicyDocument);
    const allActions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    expect(new Set(allActions)).toEqual(new Set(['lambda:InvokeFunction']));

    const { logicalId } = lambdaFunction();
    for (const stmt of statements) {
      const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
      for (const res of resources) {
        expect(JSON.stringify(res)).toContain(logicalId);
      }
    }
  });

  it('the stack-update-api Lambda role: root-stack rollback-recovery actions scoped to the root stack ARN', () => {
    const { logicalId, resource } = lambdaFunction();
    const roleArnRef = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const policies = template.findResources('AWS::IAM::Policy');
    const attachedToRole = Object.values(policies).filter((p: any) =>
      (p.Properties?.Roles ?? []).some((r: any) => r?.Ref === roleLogicalId),
    );
    const allStatements = attachedToRole.flatMap((p: any) => getPolicyStatements(p.Properties.PolicyDocument));

    const rollbackStmt = allStatements.find((s) => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('cloudformation:ContinueUpdateRollback');
    });
    expect(rollbackStmt).toBeDefined();
    expect(rollbackStmt!.Action).toEqual(
      expect.arrayContaining([
        'cloudformation:ContinueUpdateRollback',
        'cloudformation:DescribeStackResource',
        'cloudformation:DescribeStackResources',
      ]),
    );
    // Root stack ARN == `Ref AWS::StackId` (Stack.of(this).stackId — always a token, see
    // stack-update-addon.ts), never a literal or a wildcard.
    const resources = Array.isArray(rollbackStmt!.Resource) ? rollbackStmt!.Resource : [rollbackStmt!.Resource];
    expect(resources).toEqual([{ Ref: 'AWS::StackId' }]);

    void logicalId;
  });

  it('the stack-update-api Lambda role: states grants scoped to this state machine and its executions, never states:*', () => {
    const { resource } = lambdaFunction();
    const roleArnRef = resource.Properties.Role as { 'Fn::GetAtt': [string, string] };
    const roleLogicalId = roleArnRef['Fn::GetAtt'][0];

    const policies = template.findResources('AWS::IAM::Policy');
    const attachedToRole = Object.values(policies).filter((p: any) =>
      (p.Properties?.Roles ?? []).some((r: any) => r?.Ref === roleLogicalId),
    );
    const allStatements = attachedToRole.flatMap((p: any) => getPolicyStatements(p.Properties.PolicyDocument));

    const controlStmt = allStatements.find((s) => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('states:StartExecution');
    });
    expect(controlStmt).toBeDefined();
    expect(new Set(Array.isArray(controlStmt!.Action) ? controlStmt!.Action : [controlStmt!.Action])).toEqual(
      new Set(['states:StartExecution', 'states:ListExecutions']),
    );

    const describeStmt = allStatements.find((s) => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('states:DescribeExecution');
    });
    expect(describeStmt).toBeDefined();
    const describeResources = Array.isArray(describeStmt!.Resource) ? describeStmt!.Resource : [describeStmt!.Resource];
    // Execution ARN pattern: arn:...:execution:<stateMachineName>:* — must contain the ":execution:"
    // segment and a wildcard, distinguishing it from the plain state-machine ARN.
    expect(JSON.stringify(describeResources)).toContain('execution');
    expect(JSON.stringify(describeResources)).toContain('*');

    // Neither of this increment's own two new statements (StartExecution/ListExecutions,
    // DescribeExecution) grants a bare `states:*` — a broader pre-existing `states:*` statement
    // for customer-provisioned stack resources (StackResourceServices) is out of this increment's
    // scope and deliberately left untouched.
    expect(controlStmt!.Action).not.toContain('states:*');
    expect(describeStmt!.Action).not.toContain('states:*');
  });

  it('the env var carries the state machine ARN built from Aws.* tokens, never a literal account/region', () => {
    const { resource } = lambdaFunction();
    const envValue = resource.Properties.Environment.Variables.STACK_UPDATE_STATE_MACHINE_ARN;
    const rendered = JSON.stringify(envValue);

    expect(rendered).not.toContain(TEST_ACCOUNT);
    expect(rendered).not.toContain(TEST_REGION);
    expect(rendered).toContain('AWS::AccountId');
    expect(rendered).toContain('AWS::Region');
    expect(rendered).toContain('states');
    expect(rendered).toContain('stateMachine');
  });
});
