import { CloudFormationClient }          from '@aws-sdk/client-cloudformation';
import { S3Client }                      from '@aws-sdk/client-s3';
import { wrapHandler }                   from 'aws-custom-resources';

import { answerRequestWithBadConfig }    from '../shared/bad-config-answer';
import { toStackId }                     from '../shared/custom-resource-identifiers';
import type { CustomResourceRequest }    from '../shared/custom-resource-request';
import * as env                          from '../shared/env';
import { ExpectedFailure }               from '../shared/expected-failure';
import { FailedRequestAnswerer }         from '../shared/failed-request-answerer';
import { LoggerBuffer }                  from '../shared/logger-buffer';
import { emitManualFinalize }            from '../shared/manual-finalize';
import { withSmokeTest }                 from '../shared/with-smoke-test';

import { BucketAutoEmptyRequestHandler } from './bucket-auto-empty-request-handler';
import { BucketEmptier }                 from './bucket-emptier';
import { load }                          from './config';

const { config, error: configError } = env.tryLoad(load);
const bucketEmptier                  = new BucketEmptier(new S3Client({}));
const cloudFormation                 = new CloudFormationClient({});

export const handler = withSmokeTest(wrapHandler(async (event, context) => {
  const request: CustomResourceRequest = event;

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  emitManualFinalize({ ...event, StackId: toStackId(event.StackId) }, { service: config.serviceName });

  const logger                = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler        = new BucketAutoEmptyRequestHandler(bucketEmptier, logger);
  const failedRequestAnswerer = new FailedRequestAnswerer(cloudFormation, logger);

  try {
    return await requestHandler.handle(request, context);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }

    const suppressedAnswer = await failedRequestAnswerer.answer(request, failure);
    if (suppressedAnswer) {
      return suppressedAnswer;
    }
    throw failure;
  }
}), env.check(load));
