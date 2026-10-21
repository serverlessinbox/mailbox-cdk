import { CloudFormationClient }          from '@aws-sdk/client-cloudformation';
import { S3Client }                      from '@aws-sdk/client-s3';
import { wrapHandler }                   from 'aws-custom-resources';

import * as env                          from '../../runtime/handler-kit/config/config-env';
import { answerRequestWithBadConfig }    from '../../runtime/handler-kit/custom-resource/custom-resource-bad-config-answer';
import { FailedRequestAnswerer }         from '../../runtime/handler-kit/custom-resource/custom-resource-failed-request-answerer';
import { toStackId }                     from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { emitManualFinalize }            from '../../runtime/handler-kit/custom-resource/custom-resource-manual-finalize';
import type { CustomResourceRequest }    from '../../runtime/handler-kit/custom-resource/custom-resource-request';
import { ExpectedFailure }               from '../../runtime/handler-kit/errors/expected-failure';
import { LoggerBuffer }                  from '../../runtime/handler-kit/logger-buffer';
import { withSmokeTest }                 from '../../runtime/handler-kit/with-smoke-test';

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
