/// <reference types="jest" />

/**
 * ResourceSweeperStarterLambda: the environment it provisions and the grant on its role.
 *
 * The starter decides whether a Delete may sweep by reading its parent stack's status. These tests
 * pin that this read is granted on the stack's own id and nothing wider: a broader resource lets the
 * starter read any stack in the account, and a missing grant makes every lookup fail, which the
 * starter treats as "stack not being deleted" and silently skips the sweep on a real stack delete.
 * The environment is the contract with the runtime configuration: a variable the template stops
 * setting makes the starter answer every invocation with a configuration failure.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin } from '@serverlessinbox/artifact-registry-cdk';
import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { actionsOf, allPolicyStatements } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ResourceSweeperStarterLambda } from '../resource-sweeper-starter';
import { loadStarter } from '../../ts-lambdas/resource-sweeper/config';

const STATE_MACHINE_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper';

describe('ResourceSweeperStarterLambda', () => {
  let template: Template;

  beforeEach(() => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    new ResourceSweeperStarterLambda(stack, 'starter', {
      artifactResolver: new PinnedArtifactResolver({
        packages,
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      stateMachineArn: STATE_MACHINE_ARN,
    });
    template = Template.fromStack(stack);
  });

  it('grants cloudformation:DescribeStacks on the stack id and no other CloudFormation action', () => {
    const cloudFormationStatements = allPolicyStatements(template).filter((statement) =>
      actionsOf(statement).some((action) => action.startsWith('cloudformation:')),
    );

    expect(cloudFormationStatements).toEqual([
      { Action: 'cloudformation:DescribeStacks', Effect: 'Allow', Resource: { Ref: 'AWS::StackId' } },
    ]);
  });

  it('provides an environment its runtime configuration loads, with the state machine ARN it was given', () => {
    const [starter] = Object.values(template.findResources('AWS::Lambda::Function'));
    const originalEnv = process.env;
    const injectedByLambdaRuntime = { AWS_REGION: 'us-west-2', AWS_LAMBDA_FUNCTION_NAME: 'sweeper-starter-function' };
    process.env = { ...originalEnv, ...stringValues(starter.Properties.Environment.Variables), ...injectedByLambdaRuntime };

    try {
      const { config, error } = env.tryLoad(loadStarter);

      expect(error).toBeUndefined();
      expect(config?.sweeperStateMachineArn).toBe(STATE_MACHINE_ARN);
    } finally {
      process.env = originalEnv;
    }
  });
});

function stringValues(variables: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => {
      if (typeof value !== 'string') {
        throw new Error(`Environment variable ${name} is not a plain string in the template: ${JSON.stringify(value)}`);
      }
      return [name, value];
    }),
  );
}
