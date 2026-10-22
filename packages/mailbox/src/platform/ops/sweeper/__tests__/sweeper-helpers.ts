import { ArtifactZone, PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver }            from '@serverlessinbox/artifact-registry-cdk';
import { renderLiteralText }                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                       from 'aws-cdk-lib/assertions';
import * as acm                                           from 'aws-cdk-lib/aws-certificatemanager';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import * as lambda                                        from 'aws-cdk-lib/aws-lambda';
import * as sfn                                           from 'aws-cdk-lib/aws-stepfunctions';
/// <reference types="jest" />
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';
import { Construct }                                      from 'constructs';

import { StackFailedEvent }                               from '../../../../resources/events/stack-failed-event';
import { CertificateRemoval }                             from '../certificate-removal';
import { EdgeFunctionRemoval }                            from '../edge-function-removal';
import type { IResourceRemoval }                          from '../removal';
import { StackFailureDetectorRemoval }                    from '../stack-failure-detector-removal';

/** Shared fixtures of the sweeper feature's tests: a stack, real removals over imported or fresh CDK objects, and a rendered state machine. */

export function newTestStack(id: string): Stack {
  return new Stack(new App(), id, {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

export function newArtifactResolver(stack: Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
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
  readonly removal: StackFailureDetectorRemoval;
  readonly stackFailedEvent: StackFailedEvent;
  readonly role: iam.Role;
  readonly detector: lambda.IFunction;
}

export function newDetectorRemoval(scope: Construct, gracePeriod?: Duration): DetectorRemovalFixture {
  const role             = new iam.Role(scope, 'detector-role', {
    roleName: 'mailbox-diag-role-test',
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
  return statements.map((statement) => Stack.of(scope).resolve(statement.toStatementJson()));
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
  const machines  = Template.fromStack(Stack.of(scope)).findResources('AWS::StepFunctions::StateMachine');
  const [machine] = Object.values(machines);
  return renderLiteralText(machine.Properties.DefinitionString);
}

/**
 * The JSON body of one state of a rendered definition, found by brace counting on the state's own
 * `"<name>":{` key. A substring window would as often land on another state's `"Next":"<name>"`
 * as on the definition, and breaks on a Choice's nested `Choices` array.
 */
export function stateBodyOf(definition: string, stateName: string): string {
  const marker      = `"${stateName}":{`;
  const markerIndex = definition.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const start = markerIndex + marker.length - 1;
  let depth   = 0;
  for (let end = start; end < definition.length; end++) {
    if (definition[end] === '{') {
      depth++;
    } else if (definition[end] === '}') {
      depth--;
      if (depth === 0) {
        return definition.slice(start, end + 1);
      }
    }
  }
  throw new Error(`State '${stateName}' is not closed in the definition`);
}
