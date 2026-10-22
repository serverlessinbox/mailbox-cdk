/// <reference types="jest" />

/**
 * ResourceSweeperWorkerLambda: the function that deletes one removal target per invocation, and the
 * log grants it adds to the policy of its role. The worker runs on a role created before it, so the
 * function must use that role and not mint its own, and the log grants must be exactly the
 * write-only set a Lambda needs: a missing one leaves a sweep that runs with no log output.
 */

import { ArtifactZone, PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                               from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, statementsOfNamedPolicy }             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                       from 'aws-cdk-lib/assertions';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';

import { ResourceSweeperWorkerLambda }                    from '../resource-sweeper-worker-lambda';

describe('ResourceSweeperWorkerLambda', () => {
  function newStack(id: string): Stack {
    return new Stack(new App(), id, {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  }

  function addWorker(stack: Stack): { role: iam.Role; worker: ResourceSweeperWorkerLambda } {
    const packages: Record<string, ArtifactPin> = { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } };
    const artifactResolver                      = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
    const role                                  = new iam.Role(stack, 'worker-role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    const worker                                = new ResourceSweeperWorkerLambda(stack, 'worker', { artifactResolver, role });
    return { role, worker };
  }

  it('runs the worker handler for at most three minutes with 256 MB, on the role it was given', () => {
    const stack    = newStack('WorkerFunctionStack');
    const { role } = addWorker(stack);

    const [workerFunction] = Object.values(Template.fromStack(stack).findResources('AWS::Lambda::Function'));

    expect(workerFunction.Properties.Handler).toBe('index.workerHandler');
    expect(workerFunction.Properties.Timeout).toBe(Duration.minutes(3).toSeconds());
    expect(workerFunction.Properties.MemorySize).toBe(256);
    expect(workerFunction.Properties.Role).toEqual(stack.resolve(role.roleArn));
  });

  it('adds write-only log grants to the policy it is given', () => {
    const stack            = newStack('WorkerLogGrantsStack');
    const { role, worker } = addWorker(stack);
    const policy           = new iam.Policy(stack, 'worker-policy', { policyName: 'worker-policy', roles: [role] });

    worker.grantLogWriting(policy);

    const statements = statementsOfNamedPolicy(Template.fromStack(stack), 'worker-policy');
    expect(statements.map(actionsOf)).toEqual([['logs:CreateLogGroup'], ['logs:CreateLogStream', 'logs:PutLogEvents']]);
  });
});
