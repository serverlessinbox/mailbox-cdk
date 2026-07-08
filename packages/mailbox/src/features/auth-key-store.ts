import { AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { AuthKeyStoreUpdaterLambda } from '../lambdas';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { INamedTable, StackNamedTable } from '../utils/named-table';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export interface AuthKeyStoreProps {
  readonly issuers: string[];
  /**
   * Artifact resolver for building/downloading lambdas
   */
  readonly artifactResolver: ICdkArtifactEngine;
}

export class AuthKeyStore extends Construct {
  table: INamedTable;
  tableName: string;
  updaterLambda: IFunction;

  constructor(scope: Construct, id: string, props: AuthKeyStoreProps) {
    super(scope, id);
    const table = new StackNamedTable(this, 'auth-key-store', {
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const handler = new AuthKeyStoreUpdaterLambda(this, 'handler', {
      authKeyStoreTable: table,
      issuers: props.issuers,
      artifactResolver: props.artifactResolver,
    });

    this.table = table;
    this.tableName = table.tableName;
    this.updaterLambda = handler;

    // Keep the cache fresh for key rotation.
    new Rule(this, 'rule', {
      schedule: Schedule.rate(Duration.hours(6)),
      targets: [new LambdaFunction(handler)],
    });

    // Populate the cache soon after stack deploy/update completes, without using CDK custom-resource triggers.
    // This runs once per successful deploy (CREATE_COMPLETE/UPDATE_COMPLETE) for this stack.
    new Rule(this, 'populate-on-stack-complete', {
      eventPattern: {
        source: ['aws.cloudformation'],
        detailType: ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [Stack.of(this).stackId],
          'status-details': {
            status: ['CREATE_COMPLETE', 'UPDATE_COMPLETE'],
          },
        },
      },
      targets: [new LambdaFunction(handler)],
    });
  }
}
