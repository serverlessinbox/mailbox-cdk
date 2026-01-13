import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export interface EmailEntity {
  emailId: string;
  accountId: string;
  mailboxId: string; // Single mailbox per email
}

/**
 * Get email entity from DynamoDB using direct GetItem
 * Email PK: EMAIL#{emailID}, SK: METADATA
 */
export async function getEmail(
  emailID: string,
  dynamodb: DynamoDBClient,
  tableName: string
): Promise<EmailEntity | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      'pk': { S: `EMAIL#${emailID}` },
      'sk': { S: 'METADATA' },
    },
    // Only fetch the fields we need (lowercase attributes after capitalization fix)
    ProjectionExpression: 'accountId, mailboxId',
  });

  const response = await dynamodb.send(command);
  
  if (!response.Item) {
    return null;
  }

  const item = unmarshall(response.Item);
  
  return {
    emailId: emailID,
    accountId: item.accountId,
    mailboxId: item.mailboxId || '', // Single mailbox per email
  };
}
