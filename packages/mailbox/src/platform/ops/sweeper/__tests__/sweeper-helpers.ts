import { renderLiteralText }                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ServerlessInboxTagKeys }                         from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                       from 'aws-cdk-lib/assertions';
import * as acm                                           from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import * as lambda                                        from 'aws-cdk-lib/aws-lambda';
import * as sfn                                           from 'aws-cdk-lib/aws-stepfunctions';
import { Duration, Stack }                                from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';
import * as t                                             from 'typanion';

import { resourcesOfType, isTemplateValue }               from '../../../../__tests__/template-resources';
import { StackFailedEvent }                               from '../../../../resources/events/stack-failed-event';
import { CertificateRemoval }                             from '../certificate-removal';
import { EdgeFunctionRemoval }                            from '../edge-function-removal';
import type { IResourceRemoval }                          from '../removal';
import { StackFailureDetectorRemoval }                    from '../stack-failure-detector-removal';

/** Shared fixtures of the sweeper feature's tests: real removals over imported or fresh CDK objects, and a rendered state machine. */

const isStateMachineProperties = t.isPartial({ DefinitionString: isTemplateValue });

const rootStackIdKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`;

/** The IAM condition under which a removal may delete a resource tagged with this stack's id. */
export const OWNED_BY_STACK_ID = {
  StringEquals: { [rootStackIdKey]: { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] } },
};

/** The IAM condition under which a removal may delete a resource tagged with this stack's name and no stack id. */
export const OWNED_BY_STACK_NAME_WITHOUT_ID = {
  StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' } },
  Null:         { [rootStackIdKey]: 'true' },
};

export function newCertificateRemoval(scope: Construct): CertificateRemoval {
  const certificate = acm.Certificate.fromCertificateArn(
    scope,
    'cert-ref',
    'arn:aws:acm:us-west-2:123456789012:certificate/test-cert',
  );
  return new CertificateRemoval(scope, 'cert-removal', { certificate });
}

export function newEdgeFunctionRemoval(scope: Construct): EdgeFunctionRemoval {
  const edgeFunction = lambda.Function.fromFunctionArn(
    scope,
    'edge-fn-ref',
    'arn:aws:lambda:us-east-1:123456789012:function:edge-fn',
  );
  return new EdgeFunctionRemoval(scope, 'edge-fn-removal', { function: edgeFunction });
}

/** A detector removal and the CDK objects it was built over. */
export interface DetectorRemovalFixture {
  readonly removal:          StackFailureDetectorRemoval;
  readonly stackFailedEvent: StackFailedEvent;
  readonly role:             iam.Role;
  readonly detector:         lambda.IFunction;
}

export function newDetectorRemoval(scope: Construct, gracePeriod?: Duration): DetectorRemovalFixture {
  const role             = new iam.Role(scope, 'detector-role', {
    roleName:  'mailbox-diag-role-test',
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
  const detector         = lambda.Function.fromFunctionArn(
    scope,
    'detector-fn-ref',
    'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-test',
  );
  const stackFailedEvent = new StackFailedEvent(scope, 'detector-rule', { target: detector });
  const removal          = new StackFailureDetectorRemoval(scope, 'stack-failure-detector-removal', {
    stackFailedEvent,
    detector,
    role,
    detectorRolePolicyName: 'stack-failure-detector-policy',
    gracePeriod,
  });
  return { removal, stackFailedEvent, role, detector };
}

/** One of each removal type. */
export function newRemovals(scope: Construct): IResourceRemoval[] {
  return [newCertificateRemoval(scope), newEdgeFunctionRemoval(scope), newDetectorRemoval(scope).removal];
}

/** The statements as they synthesize into a template, intrinsic functions included. */
export function resolveStatements(scope: Construct, statements: iam.PolicyStatement[]): unknown[] {
  return statements.map((statement) => resolveValue(scope, statement.toStatementJson()));
}

/** A value as it synthesizes into the template of its stack, intrinsic functions included. */
export function resolveValue(scope: Construct, value: unknown): unknown {
  const resolved: unknown = Stack.of(scope).resolve(value);
  return resolved;
}

/** The definition of a state machine whose chain is the removal's own, continuing to a Succeed state named `Done`. */
export function renderRemovalChain(scope: Construct, removal: IResourceRemoval, retryInterval = Duration.minutes(5)): string {
  const done = new sfn.Succeed(scope, 'Done');
  return renderDefinition(scope, removal.buildChain(newWorkerFunction(scope), retryInterval, done));
}

export function newWorkerFunction(scope: Construct): lambda.IFunction {
  return lambda.Function.fromFunctionArn(scope, 'worker-ref', 'arn:aws:lambda:us-west-2:123456789012:function:sweeper-worker');
}

/** Wraps `chain` in a state machine of its own and returns its definition with the intrinsic functions dropped. */
export function renderDefinition(scope: Construct, chain: sfn.IChainable): string {
  new sfn.StateMachine(scope, 'rendered-machine', { definition: chain });
  const [machine] = resourcesOfType(Template.fromStack(Stack.of(scope)), 'AWS::StepFunctions::StateMachine', isStateMachineProperties);
  return renderLiteralText(machine.properties.DefinitionString);
}

/** The fields of a rendered state the sweeper tests read. */
export interface RenderedState {
  readonly Type:     string;
  readonly Next?:    string;
  readonly Default?: string;
  readonly Choices?: readonly RenderedChoiceRule[];
}

/** One rule of a rendered Choice state. */
export interface RenderedChoiceRule {
  readonly Next:          string;
  readonly StringEquals?: string;
}

interface RenderedMachine {
  readonly StartAt: string;
  readonly States:  Readonly<Record<string, RenderedState>>;
}

function machineOf(definition: string): RenderedMachine {
  return JSON.parse(definition) as RenderedMachine;
}

/** The name of the state a rendered definition starts at. */
export function startStateOf(definition: string): string {
  return machineOf(definition).StartAt;
}

/** The rendered state with the given name. */
export function stateOf(definition: string, name: string): RenderedState {
  return machineOf(definition).States[name];
}

/** The name of the one rendered state that `matches`. A test reads a state's name from the definition, never writes it. */
export function nameOfStateWhere(definition: string, matches: (state: RenderedState) => boolean): string {
  const machine = machineOf(definition);
  const names   = Object.keys(machine.States).filter((name) => matches(machine.States[name]));
  if (names.length !== 1) {
    throw new Error(`Expected exactly one matching state, found ${names.length}`);
  }
  return names[0];
}

/** The state a worker-status Choice moves to when the worker reports `status`. */
export function statusTargetOf(definition: string, status: string): string {
  const choice = nameOfStateWhere(definition, (state) => state.Choices?.some((rule) => rule.StringEquals === status) === true);
  const rule   = stateOf(definition, choice).Choices?.find((candidate) => candidate.StringEquals === status);
  if (rule === undefined) {
    throw new Error(`The status Choice has no rule for '${status}'`);
  }
  return rule.Next;
}

/** The state a presence guard enters when its target is present: the first state of the removal's loop. */
export function guardEntryOf(definition: string): string {
  const entry = stateOf(definition, startStateOf(definition)).Choices?.[0];
  if (entry === undefined) {
    throw new Error('The start state has no entry rule');
  }
  return entry.Next;
}
