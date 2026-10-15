/// <reference types="jest" />

/**
 * SweeperInfra: the execution role, worker role, worker, starter and the policies that tie them to
 * the state machine. The sweeper runs while and after its stack is torn down, so the suite pins what
 * must outlive the stack (retention), what the execution role may do (scoped, and the same under its
 * permissions boundary, or the boundary denies a grant the role holds), and that the worker role
 * holds exactly the grants the registered removals ask for.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { actionsOf, renderLiteralText, resourcesOf, statementsOfNamedPolicy } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { SweeperInfra } from '../sweeper-infra';
import { SweeperPolicyNames } from '../sweeper-names';
import { newArtifactResolver, newRemovals, newTestStack, resolveStatements } from './sweeper-helpers';

const RETAINED = { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' };

describe('SweeperInfra', () => {
  function synthesize(stackId: string): { template: Template; removals: ReturnType<typeof newRemovals>; infra: SweeperInfra; opsGroup: Construct } {
    const stack = newTestStack(stackId);
    const opsGroup = new Construct(stack, 'ops');
    const removals = newRemovals(opsGroup);
    const infra = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver: newArtifactResolver(stack), removals });
    return { template: Template.fromStack(stack), removals, infra, opsGroup };
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
      const stateMachineDeletion = statements.find((statement) => actionsOf(statement).includes('states:DeleteStateMachine'));
      expect(renderLiteralText(resourcesOf(stateMachineDeletion!)[0])).toContain('stateMachine:mailbox-sweeper-');
    });

    it('is bounded by a permissions boundary that holds exactly the grants of its inline policy', () => {
      const { template } = synthesize('ExecutionBoundaryStack');

      const boundaries = Object.values(template.findResources('AWS::IAM::ManagedPolicy'));

      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].Properties.PolicyDocument.Statement).toEqual(
        statementsOfNamedPolicy(template, SweeperPolicyNames.executionPolicy),
      );
    });
  });

  describe('worker role', () => {
    it('holds the grants of every registered removal in order, then the worker\'s log grants', () => {
      const { template, removals, opsGroup } = synthesize('WorkerPolicyStack');

      const statements = statementsOfNamedPolicy(template, SweeperPolicyNames.workerPolicy);

      const removalStatements = resolveStatements(opsGroup, removals.flatMap((removal) => removal.grantStatements()));
      expect(statements.slice(0, removalStatements.length)).toEqual(removalStatements);
      expect(statements.slice(removalStatements.length).flatMap(actionsOf)).toEqual([
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ]);
    });
  });

  describe('retention', () => {
    it('retains what the sweeper needs after the stack is deleted, and not the starter', () => {
      const { template } = synthesize('RetentionStack');

      const resourcesWhere = (type: string, matches: (properties: Record<string, unknown>) => boolean): unknown[] =>
        Object.values(template.findResources(type)).filter((resource) => matches(resource.Properties));
      const sweeperRoles = resourcesWhere('AWS::IAM::Role', (properties) => renderLiteralText(properties.RoleName).startsWith('mailbox-sweeper-'));
      const sweeperPolicies = resourcesWhere('AWS::IAM::Policy', (properties) =>
        Object.values(SweeperPolicyNames).some((name) => name === properties.PolicyName),
      );
      const worker = resourcesWhere('AWS::Lambda::Function', (properties) => properties.Handler === 'index.workerHandler');
      const starter = resourcesWhere('AWS::Lambda::Function', (properties) => properties.Handler === 'index.starterHandler');

      expect(sweeperRoles).toHaveLength(2);
      expect(sweeperPolicies).toHaveLength(2);
      expect(worker).toHaveLength(1);
      expect(starter).toHaveLength(1);
      for (const resource of [
        ...sweeperRoles,
        ...sweeperPolicies,
        ...worker,
        ...Object.values(template.findResources('AWS::IAM::ManagedPolicy')),
        ...Object.values(template.findResources('AWS::StepFunctions::StateMachine')),
      ]) {
        expect(resource).toMatchObject(RETAINED);
      }
      expect(starter[0]).not.toHaveProperty('DeletionPolicy');
    });
  });

  describe('starter', () => {
    it('is told the ARN of the state machine whose deletion the execution role is granted', () => {
      const { template } = synthesize('StarterWiringStack');

      const statements = statementsOfNamedPolicy(template, SweeperPolicyNames.executionPolicy);
      const deletion = statements.find((statement) => actionsOf(statement).includes('states:DeleteStateMachine'));
      const starter = Object.values(template.findResources('AWS::Lambda::Function')).find(
        (resource) => resource.Properties.Handler === 'index.starterHandler',
      );

      expect(starter!.Properties.Environment.Variables.MAILBOX_SWEEPER_STATE_MACHINE_ARN).toEqual(resourcesOf(deletion!)[0]);
    });
  });
});
