import type { LambdaClient } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { Config } from './config';
import { dispatchSelfInvoke } from './self-invoke';

/**
 * Handle HTTP API Gateway v2 events from the admin-UI trigger.
 *
 * Routes:
 * - POST /artifact-updates/trigger: fire-and-forget async self-invoke, respond 202
 * - else: respond 404
 */
export async function handleHttpTrigger(event: APIGatewayProxyEventV2, config: Config, lambdaClient: LambdaClient): Promise<{
  statusCode: number;
  body: string;
}> {
  const logger = new LoggerBuffer(config.serviceName, config.logLevel);
  const method = event.requestContext?.http?.method ?? '';
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';
  logger.debug('http trigger received', { method, path });

  // POST /artifact-updates/trigger: async self-invoke
  if (method === 'POST' && path.includes('/trigger')) {
    try {
      logger.debug('dispatching self-invoke');
      await dispatchSelfInvoke(lambdaClient);
      logger.debug('self-invoke dispatched');

      return {
        statusCode: 202,
        body: JSON.stringify({ status: 'triggered' }),
      };
    } catch (err: any) {
      logger.error('Failed to trigger update', {
        errorName: err?.name,
        errorMessage: err?.message,
      });
      logger.flush();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to trigger update: ${err.message}` }),
      };
    }
  }

  // Anything else: 404
  return {
    statusCode: 404,
    body: '',
  };
}
