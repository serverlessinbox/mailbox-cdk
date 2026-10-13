import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

export const TEST_ACCOUNT = '123456789012';
export const TEST_REGION = 'us-west-2';

/** One statement of a synthesized IAM policy document. */
export interface PolicyStatementJson {
  readonly Action: string | string[];
  readonly Resource: unknown;
  readonly Condition?: Record<string, Record<string, unknown>>;
}

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
  const stack = new Stack(new App(), 'TestStack', {
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

export function statementsForAction(template: Template, action: string): PolicyStatementJson[] {
  const statements: PolicyStatementJson[] = [];
  for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
    statements.push(...policy.Properties.PolicyDocument.Statement);
  }
  return statements.filter((statement) => [statement.Action].flat().includes(action));
}

/** Renders a synthesized value that may hold intrinsic functions as a string, each intrinsic as `<token>`. */
export function renderWithTokens(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const join = (value as { 'Fn::Join'?: [string, unknown[]] })['Fn::Join'];
  if (join === undefined) {
    return '<token>';
  }
  const [separator, parts] = join;
  return parts.map(renderWithTokens).join(separator);
}

export function stateMachineDefinition(template: Template): DefinitionJson {
  const machines = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
  return JSON.parse(renderWithTokens(machines[0].Properties.DefinitionString));
}

export function stateMachineLogicalId(template: Template): string {
  return Object.keys(template.findResources('AWS::StepFunctions::StateMachine'))[0];
}
