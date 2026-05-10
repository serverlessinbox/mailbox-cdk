import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export interface EmailEntity {
  emailId: string;
  accountId: string;
  mailboxId: string; // Single mailbox per email
}

/**
 * Get email entity from DynamoDB using direct GetItem
 * Email PK: TENANT#{tenantId}#EMAIL#{emailID}, SK: METADATA
 */
export async function getEmail(
  emailID: string,
  tenantId: string,
  dynamodb: DynamoDBClient,
  tableName: string
): Promise<EmailEntity | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      'pk': { S: `TENANT#${tenantId}#EMAIL#${emailID}` },
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

export interface ContactCardEntity {
  contactCardId: string;
  accountId: string;
}

/**
 * Get contact card entity from DynamoDB.
 * ContactCard PK: TENANT#{tenantId}#CONTACTCARD#{contactCardID}, SK: METADATA
 */
export async function getContactCard(
  contactCardID: string,
  tenantId: string,
  dynamodb: DynamoDBClient,
  tableName: string
): Promise<ContactCardEntity | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      'pk': { S: `TENANT#${tenantId}#CONTACTCARD#${contactCardID}` },
      'sk': { S: 'METADATA' },
    },
    ProjectionExpression: 'accountId',
  });

  const response = await dynamodb.send(command);
  if (!response.Item) return null;

  const item = unmarshall(response.Item);
  return {
    contactCardId: contactCardID,
    accountId: item.accountId,
  };
}

export interface PrincipalEntity {
  principalId: string;
  primaryAccountId: string;
}

/**
 * Get individual principal (user) entity from DynamoDB.
 * For individual principals the ID equals the UserID.
 * User PK: TENANT#{tenantId}#USER#{principalID}, SK: PROFILE
 */
export async function getPrincipal(
  principalID: string,
  tenantId: string,
  dynamodb: DynamoDBClient,
  tableName: string
): Promise<PrincipalEntity | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      'pk': { S: `TENANT#${tenantId}#USER#${principalID}` },
      'sk': { S: 'PROFILE' },
    },
    ProjectionExpression: 'primaryAccountId',
  });

  const response = await dynamodb.send(command);
  if (!response.Item) return null;

  const item = unmarshall(response.Item);
  return {
    principalId: principalID,
    primaryAccountId: item.primaryAccountId || '',
  };
}

