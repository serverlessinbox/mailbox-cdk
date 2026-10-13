import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest, emitManualFinalize, env, ExpectedFailure, LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { load } from './config';
import { TableOverrideResolver } from './table-override-resolver';

const dynamodb = new DynamoDBClient({});
const { config, error: configError } = env.tryLoad(load);

/**
 * CloudFormation custom-resource handler: answers Create and Update with the effective table ARN of
 * every data table role, and Delete with an empty answer. Config is loaded with `tryLoad` so a bad
 * config is answered as FAILED instead of killing the process before a response is sent.
 */
export const handler = withSmokeTest(wrapHandler(async (event) => {
  if (configError) throw new Error(configError);

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  emitManualFinalize(event, { service: config.serviceName });

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
