/// <reference types="jest" />

/**
 * ResourceSweeperWorkerLambda: the function that deletes one removal target per invocation. The
 * worker runs on a role created before it, so the function must use that role and not mint its own,
 * or the grants the sweeper attaches to that role never reach the function.
 */

import { ArtifactZone, PinnedArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                               from '@serverlessinbox/artifact-registry-cdk';
import { Template }                                       from 'aws-cdk-lib/assertions';
import * as iam                                           from 'aws-cdk-lib/aws-iam';
import { App, BootstraplessSynthesizer, Duration, Stack } from 'aws-cdk-lib';
import * as t                                             from 'typanion';

import { isTemplateValue, resourcesOfType }               from '../../../__tests__/template-resources';
import { ResourceSweeperWorkerLambda }                    from '../resource-sweeper-worker-lambda';

const isFunctionProperties = t.isPartial({
  Handler:    t.isString(),
  Timeout:    t.isNumber(),
  MemorySize: t.isNumber(),
  Role:       isTemplateValue,
});

describe('ResourceSweeperWorkerLambda', () => {
  it('runs the worker handler for at most three minutes with 256 MB, on the role it was given', () => {
    const stack                                 = new Stack(new App(), 'WorkerFunctionStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = { 'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL } };
    const artifactResolver                      = new PinnedArtifactResolver({
      packages,
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
    const role                                  = new iam.Role(stack, 'worker-role', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    new ResourceSweeperWorkerLambda(stack, 'worker', { artifactResolver, role });

    const [workerFunction] = resourcesOfType(Template.fromStack(stack), 'AWS::Lambda::Function', isFunctionProperties);

    const roleArn: unknown = stack.resolve(role.roleArn);
    expect(workerFunction.properties.Handler).toBe('index.workerHandler');
    expect(workerFunction.properties.Timeout).toBe(Duration.minutes(3).toSeconds());
    expect(workerFunction.properties.MemorySize).toBe(256);
    expect(workerFunction.properties.Role).toEqual(roleArn);
  });
});
