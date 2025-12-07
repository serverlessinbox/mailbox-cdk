import { AttributeType, BillingMode, ITable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { GoLambda } from './go-lambda';
import { ILambdaCodeProvider } from './lambda-code-provider';
import { INamedTable, StackNamedTable } from './named-table';

export interface JwkDynamoCacheProps {
  issuers: string[];
  /**
   * Optional CloudFront KeyValueStore ARN to also update
   * If provided, the updater will write JWKS to both DynamoDB and CloudFront KVS
   */
  keyValueStoreArn?: string;
  /**
   * Lambda code provider for building/downloading lambdas
   */
  codeProvider: ILambdaCodeProvider;
}

export class JwkDynamoCache extends Construct {
  table: INamedTable;
  tableName: string;
  updaterLambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: JwkDynamoCacheProps) {
    super(scope, id);
    this.tableName = 'mailbox-jwks-cache';
    const table = new StackNamedTable(this, 'jwks-cache', {
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const environment: Record<string, string> = {
      ISSUERS: props.issuers.join(','),
      TABLE_NAME: table.tableName,
    };
    
    // Add KeyValueStore ARN if provided
    if (props.keyValueStoreArn) {
      environment.KEY_VALUE_STORE_ARN = props.keyValueStoreArn;
    }
    
    const handler = new GoLambda(this, 'handler', {
      lambdaId: 'jwk-dynamo-cache-updater',
      codeProvider: props.codeProvider,
      memorySize: 128,
      environment,
    });
    table.grantReadWriteData(handler);
    
    // Grant KeyValueStore permissions if provided
    if (props.keyValueStoreArn) {
      handler.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'cloudfront-keyvaluestore:PutKey',
            'cloudfront-keyvaluestore:UpdateKeys',
            'cloudfront-keyvaluestore:DescribeKeyValueStore',
          ],
          resources: [props.keyValueStoreArn],
        })
      );
    }
    
    this.table = table;
    this.updaterLambda = handler;

    new Rule(this, 'rule', {
      schedule: Schedule.rate(Duration.hours(6)),
      targets: [new LambdaFunction(handler)],
    });

    // new Trigger(this, 'trigger', {
    //   handler: handler as any,
    // });
  }
}
