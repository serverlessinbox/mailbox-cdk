import { Template }             from 'aws-cdk-lib/assertions';
import * as t                   from 'typanion';

import { DeployerWorkerLambda } from '../deployer-infra/deployer-worker-lambda';

import { newProbeStack }        from './probe-stack';

const isFunctionResource = t.isPartial({
  Properties: t.isPartial({
    Environment: t.isPartial({ Variables: t.isPartial({ SERVICE_NAME: t.isString() }) }),
  }),
});

/**
 * The `SERVICE_NAME` the shared deployer worker gives itself for `deployedStackName`. A worker test
 * compares against this instead of repeating the shared composition, so only the shared worker's own
 * test pins its format.
 */
export function sharedWorkerServiceName(deployedStackName: string): string {
  const { stack, artifactResolver } = newProbeStack();
  new DeployerWorkerLambda(stack, 'worker', { artifactResolver, deployedStackName });

  const functions = Object.values(Template.fromStack(stack).findResources('AWS::Lambda::Function'));
  if (functions.length !== 1) {
    throw new Error(`Expected one Lambda function in the probe stack, found ${functions.length}`);
  }
  const errors: string[] = [];
  if (!isFunctionResource(functions[0], { errors })) {
    throw new Error(`The probe Lambda has no SERVICE_NAME: ${errors.join('; ')}`);
  }
  return functions[0].Properties.Environment.Variables.SERVICE_NAME;
}
