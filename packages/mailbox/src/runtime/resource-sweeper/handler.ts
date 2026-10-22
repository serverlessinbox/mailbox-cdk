import { ACMClient }                                                            from '@aws-sdk/client-acm';
import { CloudFormationClient }                                                 from '@aws-sdk/client-cloudformation';
import { EventBridgeClient }                                                    from '@aws-sdk/client-eventbridge';
import { IAMClient }                                                            from '@aws-sdk/client-iam';
import { LambdaClient }                                                         from '@aws-sdk/client-lambda';
import { SFNClient }                                                            from '@aws-sdk/client-sfn';
import { withSmokeTest, env, ExpectedFailure, LoggerBuffer, ParentStackStatus } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { wrapHandler }                                                          from 'aws-custom-resources';
import type { CloudFormationCustomResourceEvent }                               from 'aws-lambda';

import { loadStarter, loadWorker }                                              from './config';
import type { WorkerInput, WorkerOutput }                                       from './removal';
import { RootStackMembership }                                                  from './root-stack-membership';
import { SweepStarter }                                                         from './sweep-starter';
import { SweepTargetPlanner }                                                   from './sweep-target-planner';
import { SweepWorker }                                                          from './sweep-worker';
import { CertSweeper }                                                          from './targets/cert-sweeper';
import { EdgeFunctionSweeper }                                                  from './targets/edge-function-sweeper';
import { StackFailureDetectorSweeper }                                          from './targets/stack-failure-detector-sweeper';

// Lambda@Edge functions live in us-east-1 only, wherever the stack runs.
const LAMBDA_AT_EDGE_REGION = 'us-east-1';

const sfnClient         = new SFNClient({ region: process.env.AWS_REGION });
const acmClient         = new ACMClient({ region: process.env.AWS_REGION });
const lambdaClient      = new LambdaClient({ region: process.env.AWS_REGION });
const lambdaClientEdge  = new LambdaClient({ region: LAMBDA_AT_EDGE_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
const iamClient         = new IAMClient({ region: process.env.AWS_REGION });
const cfnClient         = new CloudFormationClient({ region: process.env.AWS_REGION });

// The starter and worker Lambdas are two physical functions sharing this code bundle, but the CDK
// gives each a different environment — so each loads only the config its own handler needs.
const { config: starterConfig, error: starterConfigError } = env.tryLoad(loadStarter);
const { config: workerConfig, error: workerConfigError }   = env.tryLoad(loadWorker);

const sweepTargetPlanner = new SweepTargetPlanner();
const STARTER_RESPONSE   = {
  PhysicalResourceId: 'mailbox-deferred-removal',
  Data: {},
};

/**
 * Step Functions worker: sweeps the one removal its payload describes.
 */
export const workerHandler = withSmokeTest(async (input: WorkerInput): Promise<WorkerOutput> => {
  // A worker with an invalid config must not sweep with a half-built one; the throw fails the task.
  if (workerConfigError) {
    throw new ExpectedFailure(workerConfigError);
  }

  const logger              = new LoggerBuffer(workerConfig.serviceName, workerConfig.logLevel);
  const rootStackMembership = new RootStackMembership(logger);
  const sweepWorker         = new SweepWorker(
    logger,
    new CertSweeper(acmClient, rootStackMembership, logger),
    new EdgeFunctionSweeper(lambdaClientEdge, rootStackMembership, logger),
    new StackFailureDetectorSweeper(eventBridgeClient, lambdaClient, iamClient, rootStackMembership, logger),
  );

  try {
    return await sweepWorker.handle(input);
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw thrown;
  }
}, env.check(loadWorker));

/**
 * CloudFormation custom-resource starter. Config is loaded with `tryLoad` so a bad config cannot
 * kill the process before a response is sent: Create and Update throw it; a Delete answers SUCCESS
 * without a sweep, so a stack in DELETE_FAILED stays fixable.
 */
export const starterHandler = withSmokeTest(wrapHandler(async (event) => {
  if (starterConfigError) {
    // A stack in DELETE_FAILED cannot be updated, so failing its Delete would leave the bad config unfixable.
    if (event.RequestType !== 'Delete') {
      throw new ExpectedFailure(starterConfigError);
    }
    console.error('Invalid starter config; answering SUCCESS to Delete without a sweep', {
      configError: starterConfigError,
    });
    return STARTER_RESPONSE;
  }

  const logger       = new LoggerBuffer(starterConfig.serviceName, starterConfig.logLevel);
  const sweepStarter = new SweepStarter(starterConfig, sfnClient, new ParentStackStatus(cfnClient, logger), sweepTargetPlanner, logger);

  // cast: wrapHandler's own event type (`TypeSafeCloudFormationResourceEvent`, from
  // `aws-custom-resources`) is `Omit<CloudFormationCustomResourceEvent, 'ResponseURL'>` — but `Omit`
  // over a union collapses it to ONE flat object keyed only by properties common to every request
  // type, which drops `OldResourceProperties` entirely (it isn't a key on the Create/Delete
  // variants), even though the real event, exactly as wrapHandler received and forwards it, always
  // carries it on Update. Re-assert the real, still-discriminated union type here instead of
  // reaching for `any` — the starter still gets full narrowing on `RequestType`.
  try {
    await sweepStarter.handle(event as CloudFormationCustomResourceEvent);
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw thrown;
  }
  return STARTER_RESPONSE;
}), env.check(loadStarter));
