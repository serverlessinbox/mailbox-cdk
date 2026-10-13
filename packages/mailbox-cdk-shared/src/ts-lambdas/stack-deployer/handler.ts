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
import { toRegion, type Region } from './deployer-identifiers';
import { StackDeployerStarter } from './stack-deployer-starter';
import { StackDeployerWorker } from './stack-deployer-worker';
import { StackDeploymentEventReader } from './stack-deployment-event-reader';
import { StackOperationFailure } from './stack-operation-failure';
import { WorkerResult } from './worker-result';

/** The part of the Lambda context both handlers read: the log stream that a response to CloudFormation points to. */
interface InvocationContext {
  readonly logStreamName?: string;
}

// The starter and the worker are two deployed functions sharing this bundle, and the CDK gives each its own
// environment, so each handler loads only its own config.
const { config: starterConfig, error: starterConfigError } = env.tryLoad(loadStarter);
const { config: workerConfig, error: workerConfigError } = env.tryLoad(loadWorker);

const awsRegion = process.env.AWS_REGION;
const stepFunctions = new SFNClient({ region: awsRegion });
const responder = new CfnResponder();
const events = new StackDeploymentEventReader();

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
  const request = events.readCfnRequest(event);
  console.info('stack-deployer-starter dispatch', {
    requestType: request.RequestType,
    logicalResourceId: request.LogicalResourceId,
  });
  const target = responder.targetForRequest(request, context.logStreamName);

  if (starterConfigError) {
    await responder.answerFailure(target, request.RequestType, responder.limitedReason(`Configuration error: ${starterConfigError}`));
    return;
  }

  // Break-glass details for releasing a resource whose handler hangs and never answers CloudFormation.
  emitManualFinalize(request, { physicalResourceId: target.physicalResourceId });

  const logger = new LoggerBuffer(starterConfig.serviceName, starterConfig.logLevel);
  const starter = new StackDeployerStarter(starterConfig.stateMachineArn, stepFunctions, events, responder, logger);

  try {
    await starter.start(request, target);
  } catch (failure) {
    if (failure instanceof ExpectedFailure) {
      await responder.answerFailure(target, request.RequestType, failure.message);
      return;
    }
    logger.flush();
    if (failure instanceof StackOperationFailure) {
      await responder.answerFailure(target, request.RequestType, responder.limitedReason(failure.message));
      return;
    }
    throw failure;
  }
}, env.check(loadStarter));

export const workerHandler = withSmokeTest(async (event: unknown, context: InvocationContext): Promise<WorkerResult> => {
  const invoke = events.readSfnInvokeEvent(event);
  console.info('stack-deployer-worker dispatch', {
    mode: invoke.mode,
    attempt: invoke.attempt,
  });
  const target = responder.targetForStep(invoke, context.logStreamName);

  if (workerConfigError) {
    await responder.answerFailure(target, invoke.op.requestType, responder.limitedReason(`Configuration error: ${workerConfigError}`));
    return WorkerResult.finished();
  }

  const logger = new LoggerBuffer(workerConfig.serviceName, workerConfig.logLevel);
  const stacks = new CloudFormationStacks(cloudFormationIn, toRegion(awsRegion ?? 'us-east-1'), logger);
  const worker = new StackDeployerWorker(stacks, responder, logger);

  try {
    return await worker.handle(invoke, target);
  } catch (failure) {
    logger.flush();
    if (failure instanceof StackOperationFailure) {
      return worker.answerFailure(invoke.op, failure, target);
    }
    throw failure;
  }
}, env.check(loadWorker));
