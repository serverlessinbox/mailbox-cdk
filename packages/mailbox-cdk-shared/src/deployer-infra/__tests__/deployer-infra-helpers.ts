import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as lambda                              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Construct }                            from 'constructs';
import * as t                                   from 'typanion';

import { renderWithTokens }                     from '../../cdk-test-support';
import { DeployerStarterLambda }                from '../deployer-starter-lambda';
import { PollingCfnDeployerWorkflow }           from '../polling-cfn-deployer-workflow';

export const TEST_ACCOUNT = '123456789012';
export const TEST_REGION = 'us-west-2';

/** One state of a synthesized state machine definition. */
export interface StateJson {
  readonly Type: string;
  readonly Next?: string;
  readonly End?: boolean;
  readonly Parameters?: Record<string, unknown>;
  readonly Seconds?: number;
  readonly Choices?: Array<{ Variable: string; BooleanEquals: boolean; Next: string }>;
  readonly Default?: string;
  readonly ResultPath?: string;
}

/** A synthesized state machine definition, with every intrinsic function replaced by a placeholder. */
export interface DefinitionJson {
  readonly StartAt: string;
  readonly TimeoutSeconds: number;
  readonly States: Record<string, StateJson>;
}

export interface DeployerTestStack {
  readonly stack: Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver that pins the package the deployer Lambdas ship in. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack            = new Stack(new App(), 'TestStack', {
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages: { 'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

/** A plain Lambda standing in for the worker, which the workflow only needs to invoke. */
export function newWorkerStandIn(scope: Construct, id: string): lambda.IFunction {
  return new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
  });
}

const isStarterFunction = t.isPartial({
  Properties: t.isPartial({
    Environment: t.isPartial({ Variables: t.isPartial({ SERVICE_NAME: t.isString() }) }),
  }),
});

/**
 * The `SERVICE_NAME` the deployer starter gives itself for `deployedStackName`. A test of a construct that
 * only passes `deployedStackName` on compares against this instead of repeating the starter's composition.
 */
export function starterServiceName(deployedStackName: string): string {
  const { stack, artifactResolver } = newDeployerTestStack();
  const workflow                    = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler: newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'probe-machine',
  });
  new DeployerStarterLambda(stack, 'starter', { artifactResolver, workflow, deployedStackName, deployedStackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/probe/*' });

  const starters         = Object.values(
    Template.fromStack(stack).findResources('AWS::Lambda::Function', { Properties: { Handler: 'index.starterHandler' } }),
  );
  const errors: string[] = [];
  if (starters.length !== 1 || !isStarterFunction(starters[0], { errors })) {
    throw new Error(`Expected one starter Lambda with a SERVICE_NAME, found ${starters.length}: ${errors.join('; ')}`);
  }
  return starters[0].Properties.Environment.Variables.SERVICE_NAME;
}

export function stateMachineDefinition(template: Template): DefinitionJson {
  const machines = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
  return JSON.parse(renderWithTokens(machines[0].Properties.DefinitionString));
}

export function stateMachineLogicalId(template: Template): string {
  return Object.keys(template.findResources('AWS::StepFunctions::StateMachine'))[0];
}
