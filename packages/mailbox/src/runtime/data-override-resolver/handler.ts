import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  answerRequestWithBadConfig,
  CaughtError,
  emitManualFinalize,
  env,
  ExpectedFailure,
  LoggerBuffer,
  readCustomResourceRequest,
  toPhysicalResourceId,
  withSmokeTest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { wrapHandler }           from 'aws-custom-resources';

import { load }                  from './config';
import { TableOverrideResolver } from './table-override-resolver';

const dynamodb                       = new DynamoDBClient({});
const { config, error: configError } = env.tryLoad(load);

/**
 * CloudFormation custom-resource handler: answers Create and Update with the effective table ARN of
 * every data table role, and Delete with an empty answer. Config is loaded with `tryLoad` so a bad
 * config is answered (FAILED for Create and Update, SUCCESS for Delete) instead of killing the process
 * before a response is sent.
 */
export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request = readCustomResourceRequest(event);

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  emitManualFinalize({ ...event, StackId: request.StackId }, { service: config.serviceName });

  try {
    if (request.RequestType === 'Delete') {
      return {};
    }

    const tableOverrideResolver = new TableOverrideResolver(dynamodb, logger);
    return {
      PhysicalResourceId: toPhysicalResourceId(request.LogicalResourceId),
      Data:               await tableOverrideResolver.resolve(request.ResourceProperties),
    };
  } catch (thrown) {
    if (!(thrown instanceof ExpectedFailure)) {
      logger.error(CaughtError.readableMessage(thrown));
      logger.flush();
    }
    throw thrown;
  }
}), env.check(load));
