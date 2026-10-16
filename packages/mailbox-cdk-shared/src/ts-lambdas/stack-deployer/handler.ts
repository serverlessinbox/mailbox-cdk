import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { SFNClient } from '@aws-sdk/client-sfn';
import * as env from '../shared/env';
import { ExpectedFailure } from '../shared/expected-failure';
import { LoggerBuffer } from '../shared/logger-buffer';
import { emitManualFinalize } from '../shared/manual-finalize';
import { withSmokeTest } from '../shared/with-smoke-test';
import { CfnResponder } from './cfn-responder';
import { CloudFormationStacks } from './cloudformation-stacks';
import { loadStarter, loadWorker } from './config';
import type { Region } from '../shared/aws-identifiers';
import { FailureAnswerer } from './failure-answerer';
import { StackDeployerStarter } from './stack-deployer-starter';
import { StackDeployerWorker } from './stack-deployer-worker';
import { StackDeploymentEventReader } from './stack-deployment-event-reader';
import { UpdateRollbackAnswerer } from './update-rollback-answerer';
import type { WorkerResult } from './worker-result';

/** The part of the Lambda context both handlers read: the log stream that a response to CloudFormation points to. */
interface InvocationContext {
  readonly logStreamName?: string;
}

// The starter and the worker are two deployed functions sharing this bundle, and the CDK gives each its own
// environment, so each handler loads only its own config.
const { config: starterConfig, error: starterConfigError } = env.tryLoad(loadStarter);
const { config: workerConfig, error: workerConfigError } = env.tryLoad(loadWorker);

const stepFunctions = new SFNClient({});
const responder = new CfnResponder((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
const events = new StackDeploymentEventReader();

// A function with no usable config has no logger or region to read a stack with, so it answers a failure without the rollback answerer.
const unconfiguredFailureAnswerer = new FailureAnswerer(events, responder, undefined);

// The parent stack of the custom resource lives in the region the function runs in.
const parentStackCloudFormation = new CloudFormationClient({});

// A stack operation names the region its stack lives in, so the CloudFormation clients are built per region on first use.
const cloudFormationClients = new Map<Region, CloudFormationClient>();
const cloudFormationIn = (region: Region): CloudFormationClient => {
  let client = cloudFormationClients.get(region);
  if (!client) {
    client = new CloudFormationClient({ region });
    cloudFormationClients.set(region, client);
  }
  return client;
};

export const starterHandler = withSmokeTest(async (event: unknown, context: InvocationContext): Promise<void> => {
  if (starterConfigError) {
    console.error('stack-deployer-starter configuration error', { error: starterConfigError });
    await unconfiguredFailureAnswerer.answerCfnRequest(event, new ExpectedFailure(`Configuration error: ${starterConfigError}`), context.logStreamName);
    return;
  }

  const logger = new LoggerBuffer(starterConfig.serviceName, starterConfig.logLevel);
  const starter = new StackDeployerStarter(starterConfig.stateMachineArn, stepFunctions, events, responder, logger);
  const stacks = new CloudFormationStacks(cloudFormationIn, starterConfig.region, logger);
  const failureAnswerer = new FailureAnswerer(events, responder, new UpdateRollbackAnswerer(parentStackCloudFormation, stacks, responder, logger));

  try {
    const request = events.readCfnRequest(event);
    console.info('stack-deployer-starter dispatch', {
      requestType: request.RequestType,
      logicalResourceId: request.LogicalResourceId,
    });
    const target = responder.targetForRequest(request, context.logStreamName);

    // Break-glass details for releasing a resource whose handler hangs and never answers CloudFormation.
    emitManualFinalize(request, { physicalResourceId: target.physicalResourceId });

    await starter.start(request, target);
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

  const logger = new LoggerBuffer(workerConfig.serviceName, workerConfig.logLevel);
  const stacks = new CloudFormationStacks(cloudFormationIn, workerConfig.region, logger);
  const rollback = new UpdateRollbackAnswerer(parentStackCloudFormation, stacks, responder, logger);
  const worker = new StackDeployerWorker(stacks, responder, rollback, logger);
  const failureAnswerer = new FailureAnswerer(events, responder, rollback);

  try {
    const invoke = events.readSfnInvokeEvent(event);
    console.info('stack-deployer-worker dispatch', {
      mode: invoke.mode,
      attempt: invoke.attempt,
    });
    return await worker.handle(invoke, responder.targetForStep(invoke, context.logStreamName));
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    return failureAnswerer.answerSfnInput(event, thrown, context.logStreamName, worker);
  }
}, env.check(loadWorker));
