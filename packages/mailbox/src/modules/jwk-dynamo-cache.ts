import { AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { JWKCacheUpdaterLambda } from '../lambdas';
import { IArtifactResolver } from '../utils/artifact-resolver';
import { INamedTable, StackNamedTable } from '../utils/named-table';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export interface JwkDynamoCacheProps {
  issuers: string[];
  /**
   * Artifact resolver for building/downloading lambdas
   */
  artifactResolver: IArtifactResolver;
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
    
    const handler = new JWKCacheUpdaterLambda(this, 'handler', {
      jwkCacheTable: table,
      issuers: props.issuers,
      artifactResolver: props.artifactResolver,
    });

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

