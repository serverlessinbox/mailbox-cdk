import { CloudFormationClient }               from '@aws-sdk/client-cloudformation';
import { SFNClient }                          from '@aws-sdk/client-sfn';

import * as env                               from '../../runtime/handler-kit/config/config-env';
import { ExpectedFailure }                    from '../../runtime/handler-kit/errors/expected-failure';
import { LoggerBuffer }                       from '../../runtime/handler-kit/logger-buffer';
import { withSmokeTest }                      from '../../runtime/handler-kit/with-smoke-test';

import { CfnResponder }                       from './answers/cfn-responder';
import { FailureAnswerer }                    from './answers/failure-answerer';
import { UpdateRollbackAnswerer }             from './answers/update-rollback-answerer';
import { CloudFormationClients }              from './cloudformation-clients';
import { CloudFormationStacks }               from './cloudformation-stacks';
import { loadStarter, loadWorker }            from './config';
import { StackDeployerStarterRequestHandler } from './stack-deployer-starter-request-handler';
import { StackDeployerStarter }               from './stack-deployer-starter';
import { StackDeployerWorkerRequestHandler }  from './stack-deployer-worker-request-handler';
import { StackDeployerWorker }                from './stack-deployer-worker';
import { StackDeploymentEventReader }         from './stack/stack-deployment-event-reader';
import type { WorkerResult }                  from './worker-result';

/** The part of the Lambda context both handlers read: the log stream that a response to CloudFormation points to. */
interface InvocationContext {
  readonly logStreamName?: string;
}

// The starter and the worker are two deployed functions sharing this bundle, and the CDK gives each its own
// environment, so each handler loads only its own config.
const { config: starterConfig, error: starterConfigError } = env.tryLoad(loadStarter);
const { config: workerConfig, error: workerConfigError }   = env.tryLoad(loadWorker);

const stepFunctions = new SFNClient({});
const responder     = new CfnResponder((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
const events        = new StackDeploymentEventReader();

// A function with no usable config has no logger or region to read a stack with, so it answers a failure without the rollback answerer.
const unconfiguredFailureAnswerer = new FailureAnswerer(events, responder, undefined);

// The parent stack of the custom resource lives in the region the function runs in.
const parentStackCloudFormation = new CloudFormationClient({});

// A stack operation names the region its stack lives in.
const cloudFormationClients = new CloudFormationClients((region) => new CloudFormationClient({ region }));

export const starterHandler = withSmokeTest(async (event: unknown, context: InvocationContext): Promise<void> => {
  if (starterConfigError) {
    console.error('stack-deployer-starter configuration error', { error: starterConfigError });
    await unconfiguredFailureAnswerer.answerCfnRequest(event, new ExpectedFailure(`Configuration error: ${starterConfigError}`), context.logStreamName);
    return;
  }

  const logger          = new LoggerBuffer(starterConfig.serviceName, starterConfig.logLevel);
  const starter         = new StackDeployerStarter(starterConfig.stateMachineArn, stepFunctions, events, responder, logger);
  const requestHandler  = new StackDeployerStarterRequestHandler(events, responder, starter);
  const stacks          = new CloudFormationStacks((region) => cloudFormationClients.forRegion(region), starterConfig.region, logger);
  const failureAnswerer = new FailureAnswerer(events, responder, new UpdateRollbackAnswerer(parentStackCloudFormation, stacks, responder, logger));

  try {
    await requestHandler.handle(event, context.logStreamName);
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    await failureAnswerer.answerCfnRequest(event, thrown, context.logStreamName);
  }
}, env.check(loadStarter));

export const workerHandler = withSmokeTest(async (event: unknown, context: InvocationContext): Promise<WorkerResult> => {
  if (workerConfigError) {
    console.error('stack-deployer-worker configuration error', { error: workerConfigError });
    return unconfiguredFailureAnswerer.answerSfnInput(event, new ExpectedFailure(`Configuration error: ${workerConfigError}`), context.logStreamName);
  }

  const logger          = new LoggerBuffer(workerConfig.serviceName, workerConfig.logLevel);
  const stacks          = new CloudFormationStacks((region) => cloudFormationClients.forRegion(region), workerConfig.region, logger);
  const rollback        = new UpdateRollbackAnswerer(parentStackCloudFormation, stacks, responder, logger);
  const worker          = new StackDeployerWorker(stacks, responder, rollback, logger);
  const requestHandler  = new StackDeployerWorkerRequestHandler(events, responder, worker);
  const failureAnswerer = new FailureAnswerer(events, responder, rollback);

  try {
    return await requestHandler.handle(event, context.logStreamName);
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    return failureAnswerer.answerSfnInput(event, thrown, context.logStreamName, worker);
  }
}, env.check(loadWorker));
