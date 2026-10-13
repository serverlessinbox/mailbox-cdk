import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { S3Client } from '@aws-sdk/client-s3';
import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emitManualFinalize } from '../shared/manual-finalize';
import { answerRequestWithBadConfig } from '../shared/bad-config-answer';
import type { CustomResourceRequest } from '../shared/custom-resource-request';
import * as env from '../shared/env';
import { ExpectedFailure } from '../shared/expected-failure';
import { FailedRequestAnswerer } from '../shared/failed-request-answerer';
import { LoggerBuffer } from '../shared/logger-buffer';
import { load } from './config';
import { ContentDeployerRequestHandler } from './content-deployer-request-handler';

const { config, error: configError } = env.tryLoad(load);
const s3 = new S3Client({});
const cloudFront = new CloudFrontClient({});
const cloudFormation = new CloudFormationClient({});

export const handler = withSmokeTest(wrapHandler(async (event, context) => {
  const request: CustomResourceRequest = event;

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  emitManualFinalize(event, { service: config.serviceName });

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler = new ContentDeployerRequestHandler(s3, cloudFront, logger);
  const failedRequestAnswerer = new FailedRequestAnswerer(cloudFormation, logger);

  try {
    return await requestHandler.handle(request, context.logGroupName);
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
