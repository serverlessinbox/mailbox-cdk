/// <reference types="jest" />

/**
 * Pins how a deployer's pieces are assembled: where the worker is parented, which names the workflow and
 * starter get, and the custom resource every deployer creates through `deployStack`. The fixed worker
 * path keeps logical IDs, and so the live custom resources' service tokens, stable across deploys; the
 * resource must depend on the workflow so the workflow can still answer its delete.
 */

import { Match, Template }                                                                   from 'aws-cdk-lib/assertions';
import type { IFunction }                                                                    from 'aws-cdk-lib/aws-lambda';
import { Stack }                                                                             from 'aws-cdk-lib';
import { Construct }                                                                         from 'constructs';

import { DeployerInfra }                                                                     from '../deployer-infra';
import { PositionHash }                                                                      from '../naming/position-hash';
import { StackIdentity }                                                                     from '../naming/stack-identity';
import type { StackDeployerProperties }                                                      from '../runtime/stack-deployer/stack/stack-deployment';

import { newDeployerTestStack, newWorkerStandIn, starterServiceName, stateMachineLogicalId } from './deployer-infra-helpers';

const DEPLOYMENT: StackDeployerProperties = {
  stackName: 'sub-stack',
  templateUrl: 'https://bucket.s3.amazonaws.com/template.json',
  parameters: { nameBase: 'base' },
  preserveOnDelete: true,
  region: 'us-east-1',
};

interface SynthesizedInfra {
  readonly stack: Stack;
  readonly createWorker: jest.Mock<IFunction, [Construct, string]>;
  readonly infra: DeployerInfra;
}

function newInfra(): SynthesizedInfra {
  const { stack, artifactResolver } = newDeployerTestStack();
  const createWorker                = jest.fn((scope: Construct, id: string) => newWorkerStandIn(scope, id));
  const infra                       = new DeployerInfra(stack, 'infra', {
    artifactResolver,
    stateMachineNamePrefix: 'test-deployer-',
    deployedStackName: 'cognito',
    deployedStackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/sub-stack/*',
    createWorker,
  });
  return { stack, createWorker, infra };
}

describe('DeployerInfra', () => {
  it('builds the worker once, as the infra construct’s child "worker"', () => {
    const { createWorker, infra } = newInfra();

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith(infra, 'worker');
  });

  it('names the state machine by the prefix, the infra position hash and the guid prefix of the stack id', () => {
    const { stack, infra } = newInfra();

    Template.fromStack(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineName: {
        'Fn::Join': ['', [`test-deployer-${PositionHash.of(infra)}-`, stack.resolve(StackIdentity.guidPrefix)]],
      },
    });
  });

  it('starts the workflow from a starter Lambda named for the sub-stack it drives', () => {
    const { stack } = newInfra();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.starterHandler',
      Environment: { Variables: { SERVICE_NAME: starterServiceName('cognito') } },
    });
  });

  describe('deployStack', () => {
    it('creates the typed custom resource as the given scope’s child with the given id, passing the properties through', () => {
      const { stack, infra } = newInfra();
      const deployer         = new Construct(stack, 'deployer');

      infra.deployStack(deployer, 'sub-stack', 'Custom::TestDeployer', DEPLOYMENT);

      const resources = Template.fromStack(stack).findResources('Custom::TestDeployer');
      expect(Object.keys(resources)).toEqual([expect.stringMatching(/^deployersubstack[0-9A-F]{8}$/)]);
      expect(Object.values(resources)[0].Properties).toMatchObject(DEPLOYMENT);
    });

    it('is served by the starter Lambda, with a one hour service timeout', () => {
      const { stack, infra } = newInfra();

      infra.deployStack(new Construct(stack, 'deployer'), 'resource', 'Custom::TestDeployer', DEPLOYMENT);

      const template = Template.fromStack(stack);
      const starter  = Object.keys(template.findResources('AWS::Lambda::Function', {
        Properties: { Handler: 'index.starterHandler' },
      }))[0];
      template.hasResourceProperties('Custom::TestDeployer', {
        ServiceToken: { 'Fn::GetAtt': [starter, 'Arn'] },
        ServiceTimeout: '3600',
      });
    });

    it('depends on the state machine, so the workflow outlives the resource', () => {
      const { stack, infra } = newInfra();

      infra.deployStack(new Construct(stack, 'deployer'), 'resource', 'Custom::TestDeployer', DEPLOYMENT);

      const template = Template.fromStack(stack);
      template.hasResource('Custom::TestDeployer', {
        DependsOn: Match.arrayWith([stateMachineLogicalId(template)]),
      });
    });
  });
});
