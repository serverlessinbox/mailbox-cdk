import { ITable, TableProps } from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseTable } from './base-table';
import { sanitizeStackName } from './sanitize-name';

export interface INamedTable extends ITable {
  readonly explicitTableName: string;
}

export class StackNamedTable extends BaseTable implements INamedTable {
  readonly explicitTableName: string;

  constructor(scope: Construct, tableName: string, props: TableProps) {
    const stack = cdk.Stack.of(scope);
    const sanitizedStackName = sanitizeStackName(stack.stackName);
    const fullTableName = `${Aws.ACCOUNT_ID}-${Aws.STACK_NAME}-${tableName}`;
    // Use a static construct ID when the account is an unresolved CDK token
    // (synth / unit-test contexts). When the account is a concrete value (a
    // deployed stack with a known account), preserve the legacy embedded-account
    // form so that `cdk import` can map old logical IDs to physical tables
    // during the one-time logical-ID migration.
    const constructId = cdk.Token.isUnresolved(stack.account)
      ? tableName
      : `${stack.account}-${sanitizedStackName}-${tableName}`;
    super(scope, constructId, {
      ...props,
      tableName: fullTableName,
    });

    this.explicitTableName = fullTableName;
  }
}
