import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { Template }                             from 'aws-cdk-lib/assertions';
import * as lambda                              from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Construct }                            from 'constructs';
import * as t                                   from 'typanion';

import { renderWithTokens }                     from '../cdk-test-support';
import { DeployerStarterLambda }                from '../resources/lambdas/deployer-starter-lambda';
import { PollingCfnDeployerWorkflow }           from '../resources/workflows/polling-cfn-deployer-workflow';

export const TEST_ACCOUNT = '123456789012';
export const TEST_REGION  = 'us-west-2';

const isStateJson = t.isPartial({
  Type:       t.isString(),
  Next:       t.isOptional(t.isString()),
  End:        t.isOptional(t.isBoolean()),
  Parameters: t.isOptional(t.isRecord(t.isOneOf([t.isString(), t.isNumber()]))),
  Seconds:    t.isOptional(t.isNumber()),
  Choices:    t.isOptional(t.isArray(t.isPartial({ Variable: t.isString(), BooleanEquals: t.isBoolean(), Next: t.isString() }))),
  Default:    t.isOptional(t.isString()),
  ResultPath: t.isOptional(t.isString()),
});

const isDefinitionJson = t.isPartial({
  StartAt:        t.isString(),
  TimeoutSeconds: t.isNumber(),
  States:         t.isRecord(isStateJson),
});

const isStateMachineResource = t.isPartial({
  Properties: t.isPartial({ DefinitionString: t.isOneOf([t.isString(), t.isPartial({})]) }),
});

/** A synthesized state machine definition, with every intrinsic function replaced by a placeholder. */
export type DefinitionJson = t.InferType<typeof isDefinitionJson>;

export interface DeployerTestStack {
  readonly stack:            Stack;
  readonly artifactResolver: IArtifactResolver;
}

/** A stack with an explicit environment and a resolver that pins the package the deployer Lambdas ship in. */
export function newDeployerTestStack(): DeployerTestStack {
  const stack            = new Stack(new App(), 'TestStack', {
    env:         { account: TEST_ACCOUNT, region: TEST_REGION },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const artifactResolver = new PinnedArtifactResolver({
    packages:         { 'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  return { stack, artifactResolver };
}

/** A plain Lambda standing in for the worker, which the workflow only needs to invoke. */
export function newWorkerStandIn(scope: Construct, id: string): lambda.IFunction {
  return new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code:    lambda.Code.fromInline('exports.handler = async () => ({});'),
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
    handler:          newWorkerStandIn(stack, 'worker'),
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

/** The definition of the template's one state machine, parsed from its synthesized definition string; one that is not shaped like a state machine definition throws. */
export function stateMachineDefinition(template: Template): DefinitionJson {
  const [machine]         = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
  const resource: unknown = machine;
  const errors: string[]  = [];
  if (!isStateMachineResource(resource, { errors })) {
    throw new Error(`Not a state machine resource: ${errors.join('; ')}`);
  }

  const definition: unknown = JSON.parse(renderWithTokens(resource.Properties.DefinitionString));
  if (!isDefinitionJson(definition, { errors })) {
    throw new Error(`Not a state machine definition: ${errors.join('; ')}`);
  }
  return definition;
}

export function stateMachineLogicalId(template: Template): string {
  return Object.keys(template.findResources('AWS::StepFunctions::StateMachine'))[0];
}
