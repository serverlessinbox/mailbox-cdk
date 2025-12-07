import { AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { GoLambda } from '../utils/go-lambda';
import { ILambdaCodeProvider } from '../utils/lambda-code-provider';
import { INamedTable, StackNamedTable } from '../utils/named-table';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export interface JwkDynamoCacheProps {
  issuers: string[];
  /**
   * Lambda code provider for building/downloading lambdas
   */
  codeProvider: ILambdaCodeProvider;
}

export class JwkDynamoCache extends Construct {
  table: INamedTable;
  tableName: string;
  updaterLambda: IFunction;

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
    
    const handler = new GoLambda(this, 'handler', {
      lambdaId: 'jwk-dynamo-cache-updater',
      codeProvider: props.codeProvider,
      memorySize: 128,
      environment: {
        ISSUERS: props.issuers.join(','),
        TABLE_NAME: table.tableName,          
      }
    });

    table.grantReadWriteData(handler);

    this.table = table;
    this.updaterLambda = handler;

    new Rule(this, 'rule', {
      schedule: Schedule.rate(Duration.hours(6)),
      targets: [new LambdaFunction(handler)],
    });

    new Trigger(this, 'trigger', {
      handler: handler as any,
    });
  }
}
