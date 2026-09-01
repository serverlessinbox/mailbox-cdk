import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { LoggerBuffer } from '../shared/logger-buffer';
import { dispatchSelfInvoke } from './self-invoke';

/**
 * Handle HTTP API Gateway v2 events from the admin-UI trigger.
 *
 * Routes:
 * - POST /artifact-updates/trigger: fire-and-forget async self-invoke, respond 202
 * - GET  /artifact-updates/status:  sync GetItem on lock table, respond 200 with status
 * - else: respond 404
 */
export async function handleHttpTrigger(event: APIGatewayProxyEventV2, service?: string): Promise<{
  statusCode: number;
  body: string;
}> {
  const logger = new LoggerBuffer(service);
  const method = event.requestContext?.http?.method ?? '';
  const path = event.requestContext?.http?.path ?? event.rawPath ?? '';
  logger.debug('http trigger received', { method, path });

  // POST /artifact-updates/trigger: async self-invoke
  if (method === 'POST' && path.includes('/trigger')) {
    try {
      logger.debug('dispatching self-invoke');
      await dispatchSelfInvoke();
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

  // GET /artifact-updates/status: sync read from lock table
  if (method === 'GET' && path.includes('/status')) {
    const dynamoClient = new DynamoDBClient({});
    const tableName = process.env.LOCK_TABLE_NAME || '';

    if (!tableName) {
      logger.error('LOCK_TABLE_NAME not set');
      logger.flush();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'LOCK_TABLE_NAME not set' }),
      };
    }

    try {
      logger.debug('reading status from lock table', { tableName });
      const response = await dynamoClient.send(
        new GetItemCommand({
          TableName: tableName,
          Key: {
            pk: { S: 'STACK-UPDATER' },
            sk: { S: 'STATUS' },
          },
        }),
      );

      const item = response.Item ?? {};
      logger.debug('status read succeeded', { hasItem: Object.keys(item).length > 0 });
      return {
        statusCode: 200,
        body: JSON.stringify(item),
      };
    } catch (err: any) {
      logger.error('Failed to read status', {
        errorName: err?.name,
        errorMessage: err?.message,
      });
      logger.flush();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to read status: ${err.message}` }),
      };
    }
  }

  // Anything else: 404
  return {
    statusCode: 404,
    body: '',
  };
}
