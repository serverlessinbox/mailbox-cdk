import { Construct } from 'constructs';
import { StackNamedTable } from '../utils/named-table';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import type { TableProps } from 'aws-cdk-lib/aws-dynamodb';

/**
 * DynamoDB table for changelog and state management
 * 
 * Optimized structure:
 * PK: {accountId}#{objectType}        e.g., "acc_xxx#Email"
 * SK: {state}                          e.g., 156 (number)
 * 
 * State counter (SK=0):
 * - v: current state value (number)
 * 
 * Changelog entries (SK>0):
 * - o: objectId (string)
 * - c: changeType (c/u/d)
 * - x: expiresAt (TTL)
 */
export class ChangelogTable extends StackNamedTable {

  constructor(scope: Construct, props: Partial<TableProps> = {}) {
    super(scope, 'changelog-table', {
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.NUMBER,
      },
      timeToLiveAttribute: 'x', // TTL on 'x' (expiresAt) field
      pointInTimeRecovery: true,
      ...props,
    });
  }
}
