import { wrapHandler } from 'aws-custom-resources';
import {
  answerRequestWithBadConfig,
  withSmokeTest,
  emitManualFinalize,
  env,
  ExpectedFailure,
  LoggerBuffer,
  toStackId,
  type CustomResourceRequest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { load } from './config';
import { TableOverrideResolver } from './table-override-resolver';

const dynamodb = new DynamoDBClient({});
const { config, error: configError } = env.tryLoad(load);

/**
 * CloudFormation custom-resource handler: answers Create and Update with the effective table ARN of
 * every data table role, and Delete with an empty answer. Config is loaded with `tryLoad` so a bad
 * config is answered (FAILED for Create and Update, SUCCESS for Delete) instead of killing the process
 * before a response is sent.
 */
export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request: CustomResourceRequest = event;

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  emitManualFinalize({ ...event, StackId: toStackId(event.StackId) }, { service: config.serviceName });

  try {
    if (event.RequestType === 'Delete') {
      return {};
    }

    const tableOverrideResolver = new TableOverrideResolver(dynamodb, logger);
    return {
      PhysicalResourceId: event.LogicalResourceId,
      Data: await tableOverrideResolver.resolve(event.ResourceProperties),
    };
  } catch (thrown) {
    logger.error(thrown instanceof Error ? thrown.message : String(thrown));
    if (!(thrown instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw thrown;
  }
}), env.check(load));
