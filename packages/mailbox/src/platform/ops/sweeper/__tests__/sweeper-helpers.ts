import { ArtifactZone, PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }            from '@serverlessinbox/artifact-registry-cdk';
import { renderLiteralText }                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ServerlessInboxTagKeys }                         from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                       from 'aws-cdk-lib/assertions';
import * as acm                                           from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import * as lambda                                        from 'aws-cdk-lib/aws-lambda';
import * as sfn                                           from 'aws-cdk-lib/aws-stepfunctions';
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';
import * as t                                             from 'typanion';

import { resourcesOfType, isTemplateValue }               from '../../../../__tests__/template-resources';
import { StackFailedEvent }                               from '../../../../resources/events/stack-failed-event';
import { CertificateRemoval }                             from '../certificate-removal';
import { EdgeFunctionRemoval }                            from '../edge-function-removal';
import type { IResourceRemoval }                          from '../removal';
import { StackFailureDetectorRemoval }                    from '../stack-failure-detector-removal';

/** Shared fixtures of the sweeper feature's tests: a stack, real removals over imported or fresh CDK objects, and a rendered state machine. */

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

export function newTestStack(id: string): Stack {
  return new Stack(new App(), id, {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

export function newArtifactResolver(stack: Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

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
