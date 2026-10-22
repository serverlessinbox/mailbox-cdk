import {
  answerRequestWithBadConfig,
  withSmokeTest,
  env,
  ExpectedFailure,
  LoggerBuffer,
  readCustomResourceRequest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { wrapHandler }                            from 'aws-custom-resources';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

import { loadStarter, loadWorker }                from './config';
import type { WorkerOutput }                      from './removal';
import { SweepStarterComposition }                from './sweep-starter-composition';
import { SweepWorkerComposition }                 from './sweep-worker-composition';

// The starter and worker Lambdas are two physical functions sharing this code bundle, but the CDK
// gives each a different environment — so each loads only the config its own handler needs.
const { config: starterConfig, error: starterConfigError } = env.tryLoad(loadStarter);
const { config: workerConfig, error: workerConfigError }   = env.tryLoad(loadWorker);

const starterComposition = new SweepStarterComposition(starterConfig);
const workerComposition  = new SweepWorkerComposition(workerConfig);

/**
 * Step Functions worker: sweeps the one removal its payload describes.
 */
export const workerHandler = withSmokeTest(async (payload: unknown): Promise<WorkerOutput> => {
  // A worker with an invalid config must not sweep with a half-built one; the throw fails the task.
  if (workerConfigError) {
    throw new ExpectedFailure(workerConfigError);
  }

  const logger = new LoggerBuffer(workerConfig.serviceName, workerConfig.logLevel);

  try {
    return await workerComposition.sweepWorker(logger).handle(payload);
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
    return answerRequestWithBadConfig(readCustomResourceRequest(event), starterConfigError);
  }

  const logger = new LoggerBuffer(starterConfig.serviceName, starterConfig.logLevel);

  // cast: wrapHandler's own event type (`TypeSafeCloudFormationResourceEvent`, from
  // `aws-custom-resources`) is `Omit<CloudFormationCustomResourceEvent, 'ResponseURL'>` — but `Omit`
  // over a union collapses it to ONE flat object keyed only by properties common to every request
  // type, which drops `OldResourceProperties` entirely (it isn't a key on the Create/Delete
  // variants), even though the real event, exactly as wrapHandler received and forwards it, always
  // carries it on Update. Re-assert the real, still-discriminated union type here instead of
  // reaching for `any` — the starter still gets full narrowing on `RequestType`.
  try {
    return await starterComposition.sweepStarter(logger).handle(event as CloudFormationCustomResourceEvent);
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw thrown;
  }
}), env.check(loadStarter));
