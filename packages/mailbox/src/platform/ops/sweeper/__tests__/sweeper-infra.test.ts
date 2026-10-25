/// <reference types="jest" />

/**
 * SweeperInfra: the execution role, worker role, worker, starter and the policies that tie them to
 * the state machine. The sweeper runs while and after its stack is torn down, so the suite pins what
 * must outlive the stack (retention), what the execution role may do (scoped, and the same under its
 * permissions boundary, or the boundary denies a grant the role holds), and that the worker role
 * holds exactly the grants the registered removals ask for plus the log grants of the worker, in the
 * partition of the stack.
 */

import { actionsOf, renderLiteralText, resourcesOf, statementsOfNamedPolicy } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { PositionHash }                                                       from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                           from 'aws-cdk-lib/assertions';
import { Construct }                                                          from 'constructs';
import * as t                                                                 from 'typanion';

import { isTemplateValue, resourcesOfType }                                   from '../../../../__tests__/template-resources';
import type { TemplateResource }                                              from '../../../../__tests__/template-resources';
import { SweeperPolicyNames }                                                 from '../../../../resources/workflows/sweeper-workflow';
import { newArtifactResolver, newTestStack }                                  from '../../../__tests__/platform-helpers';
import { SweeperInfra }                                                       from '../sweeper-infra';
import { SweeperWorkerRoleRemoval }                                           from '../sweeper-worker-role-removal';

import { newRemovals, resolveStatements }                                     from './sweeper-helpers';

const RETAINED = { deletionPolicy: 'RetainExceptOnCreate', updateReplacePolicy: 'Retain' };

const isRoleProperties          = t.isPartial({ RoleName: t.isOptional(isTemplateValue) });
const isPolicyProperties        = t.isPartial({
  PolicyName:     t.isString(),
  Roles:          t.isArray(t.isPartial({ Ref: t.isString() })),
  PolicyDocument: t.isPartial({ Statement: t.isArray(t.isPartial({})) }),
});
const isManagedPolicyProperties = t.isPartial({ PolicyDocument: t.isPartial({ Statement: t.isArray(t.isPartial({})) }) });
const isStateMachineProperties  = t.isPartial({ StateMachineName: isTemplateValue });
const isFunctionProperties      = t.isPartial({
  Handler:     t.isString(),
  Environment: t.isOptional(t.isPartial({ Variables: t.isRecord(isTemplateValue) })),
});

type FunctionProperties = t.InferType<typeof isFunctionProperties>;

describe('SweeperInfra', () => {
  function synthesize(stackId: string): { template: Template; removals: ReturnType<typeof newRemovals>; infra: SweeperInfra; opsGroup: Construct } {
    const stack    = newTestStack(stackId);
    const opsGroup = new Construct(stack, 'ops');
    const removals = newRemovals(opsGroup);
    const infra    = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver: newArtifactResolver(stack), removals });
    return { template: Template.fromStack(stack), removals, infra, opsGroup };
  }

  function functionWithHandler(template: Template, handler: string): TemplateResource<FunctionProperties> {
    const match = resourcesOfType(template, 'AWS::Lambda::Function', isFunctionProperties).find((candidate) => candidate.properties.Handler === handler);
    if (match === undefined) {
      throw new Error(`No function with handler ${handler}`);
    }
    return match;
  }

  describe('execution role', () => {
    it('scopes role-policy and state-machine deletion to named ARNs, never a wildcard', () => {
      const { template } = synthesize('ExecutionScopeStack');

      const statements = statementsOfNamedPolicy(template, SweeperPolicyNames.executionPolicy);

      const roleDeletions = statements.filter((statement) => actionsOf(statement).includes('iam:DeleteRolePolicy'));
      expect(roleDeletions.map((statement) => renderLiteralText(resourcesOf(statement)[0]))).toEqual([
        expect.stringContaining('role/mailbox-sweeper-worker-'),
        expect.stringContaining('role/mailbox-sweeper-exec-'),
      ]);
      const stateMachineDeletions = statements.filter((statement) => actionsOf(statement).includes('states:DeleteStateMachine'));
      expect(stateMachineDeletions.map((statement) => renderLiteralText(resourcesOf(statement)[0]))).toEqual([
        expect.stringContaining('stateMachine:mailbox-sweeper-'),
      ]);
    });

    it('is bounded by a permissions boundary that holds exactly the grants of its inline policy', () => {
      const { template } = synthesize('ExecutionBoundaryStack');

      const boundaries = resourcesOfType(template, 'AWS::IAM::ManagedPolicy', isManagedPolicyProperties);

      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].properties.PolicyDocument.Statement).toEqual(
        statementsOfNamedPolicy(template, SweeperPolicyNames.executionPolicy),
      );
    });
  });

  describe('execution role policies', () => {
    it('has only the named execution policy attached, so the boundary cannot cut a statement it holds', () => {
      const { template } = synthesize('ExecutionOnlyPolicyStack');

      const [executionRole]  = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).filter((role) =>
        renderLiteralText(role.properties.RoleName).startsWith('mailbox-sweeper-exec-'),
      );
      const attachedPolicies = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties).filter((policy) =>
        policy.properties.Roles.some((role) => role.Ref === executionRole.logicalId),
      );
      const [boundary]       = resourcesOfType(template, 'AWS::IAM::ManagedPolicy', isManagedPolicyProperties);

      expect(attachedPolicies.map((policy) => policy.properties.PolicyName)).toEqual([SweeperPolicyNames.executionPolicy]);
      expect(boundary.properties.PolicyDocument.Statement).toEqual(
        expect.arrayContaining(attachedPolicies.flatMap((policy) => policy.properties.PolicyDocument.Statement)),
      );
    });
  });

  describe('physical names', () => {
    it('start with a position hash, so moving the sweeper never reuses a retained name', () => {
      const { template, infra } = synthesize('PhysicalNamesStack');
      const hash                = PositionHash.of(infra);

      const roleNames      = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).map((role) => renderLiteralText(role.properties.RoleName));
      const [stateMachine] = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);

      expect(roleNames).toEqual(
        expect.arrayContaining([
          expect.stringMatching(new RegExp(`^mailbox-sweeper-exec-${hash}-`)),
          expect.stringMatching(new RegExp(`^mailbox-sweeper-worker-${hash}-`)),
        ]),
      );
      // The state machine is named by the position of its workflow construct, not of the sweeper.
      expect(renderLiteralText(stateMachine.properties.StateMachineName)).toMatch(new RegExp(`^mailbox-sweeper-${PositionHash.ofChild(infra, 'workflow')}-`));
    });
  });

  describe('state machine', () => {
    it('depends on the named execution policy, so no execution starts before the role holds its grants', () => {
      const { template } = synthesize('StateMachineOrderStack');

      const [executionPolicy] = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties).filter(
        (policy) => policy.properties.PolicyName === SweeperPolicyNames.executionPolicy,
      );
      const [stateMachine]    = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);

      expect(stateMachine.dependsOn).toContain(executionPolicy.logicalId);
    });
  });

  describe('worker role', () => {
    it('holds the grants of every registered removal in order, its own worker role removal last, then the worker\'s write-only log grants in the stack\'s partition', () => {
      const { template, removals, opsGroup } = synthesize('WorkerPolicyStack');

      const statements = statementsOfNamedPolicy(template, SweeperPolicyNames.workerPolicy);

      const workerRoleRemoval = new SweeperWorkerRoleRemoval(opsGroup, 'expected-worker-role-removal', {
        workerRoleArn:        'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222',
        workerRolePolicyName: SweeperPolicyNames.workerPolicy,
      });
      const removalStatements = resolveStatements(opsGroup, [
        ...removals.flatMap((removal) => removal.grantStatements()),
        ...workerRoleRemoval.grantStatements(),
      ]);
      const logArn            = (resource: string): unknown => ({
        'Fn::Join': [
          '',
          ['arn:', { Ref: 'AWS::Partition' }, ':logs:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, `:${resource}`],
        ],
      });
      expect(statements.slice(0, removalStatements.length)).toEqual(removalStatements);
      expect(statements.slice(removalStatements.length)).toEqual([
        { Action: 'logs:CreateLogGroup', Effect: 'Allow', Resource: logArn('*') },
        {
          Action:   ['logs:CreateLogStream', 'logs:PutLogEvents'],
          Effect:   'Allow',
          Resource: [logArn('log-group:*'), logArn('log-group:*:*')],
        },
      ]);
    });
  });

  describe('retention', () => {
    it('retains what the sweeper needs after the stack is deleted, and not the starter', () => {
      const { template } = synthesize('RetentionStack');

      const sweeperRoles    = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).filter((role) =>
        renderLiteralText(role.properties.RoleName).startsWith('mailbox-sweeper-'),
      );
      const sweeperPolicies = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties).filter((policy) =>
        Object.values(SweeperPolicyNames).some((name) => name === policy.properties.PolicyName),
      );
      const worker          = functionWithHandler(template, 'index.workerHandler');
      const starter         = functionWithHandler(template, 'index.starterHandler');

      expect(sweeperRoles).toHaveLength(2);
      expect(sweeperPolicies).toHaveLength(2);
      for (const resource of [
        ...sweeperRoles,
        ...sweeperPolicies,
        worker,
        ...resourcesOfType(template, 'AWS::IAM::ManagedPolicy', isManagedPolicyProperties),
        ...resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties),
      ]) {
        expect(resource).toMatchObject(RETAINED);
      }
      expect(starter.deletionPolicy).toBeUndefined();
    });
  });

  describe('starter', () => {
    it('is told the ARN of the state machine whose deletion the execution role is granted', () => {
      const { template } = synthesize('StarterWiringStack');

      const statements = statementsOfNamedPolicy(template, SweeperPolicyNames.executionPolicy);
      const deletions  = statements.filter((statement) => actionsOf(statement).includes('states:DeleteStateMachine'));
      const starter    = functionWithHandler(template, 'index.starterHandler');

      expect(deletions).toHaveLength(1);
      expect(starter.properties.Environment?.Variables.MAILBOX_SWEEPER_STATE_MACHINE_ARN).toEqual(resourcesOf(deletions[0])[0]);
    });

    it('depends on the state machine, so a replaced state machine exists before any sweep starts', () => {
      const { template } = synthesize('StarterOrderStack');

      const [stateMachine] = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);
      const starter        = functionWithHandler(template, 'index.starterHandler');

      expect(starter.dependsOn).toContain(stateMachine.logicalId);
    });
  });
});
