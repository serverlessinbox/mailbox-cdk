import { wrapHandler } from 'aws-custom-resources';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { S3Client } from '@aws-sdk/client-s3';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emitManualFinalize } from '../shared/manual-finalize';
import * as env from '../shared/env';
import { ExpectedFailure } from '../shared/expected-failure';
import { LoggerBuffer } from '../shared/logger-buffer';
import { load } from './config';
import { BucketEmptier } from './bucket-emptier';
import { BucketAutoEmptyRequestHandler, type BucketAutoEmptyRequest } from './bucket-auto-empty-request-handler';

const { config, error: configError } = env.tryLoad(load);
const bucketEmptier = new BucketEmptier(new S3Client({}));
const cloudFormation = new CloudFormationClient({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  // wrapHandler's event type does not declare PhysicalResourceId, which every Update and Delete carries.
  const request: BucketAutoEmptyRequest = event;

  if (configError) {
    if (request.RequestType === 'Delete') {
      console.error('Configuration error on Delete; responding SUCCESS so stack deletion is not blocked', { error: configError });
      return { PhysicalResourceId: request.PhysicalResourceId };
    }
    throw new Error(configError);
  }

  emitManualFinalize(event, { service: config.serviceName });

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler = new BucketAutoEmptyRequestHandler(bucketEmptier, cloudFormation, logger);

  try {
    return await requestHandler.handle(request);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }

    const suppressedAnswer = await requestHandler.answerFailedRequest(request, failure);
    if (suppressedAnswer) {
      return suppressedAnswer;
    }
    throw failure;
  }
}), env.check(load));
