import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { LicenseRefresherLambda } from '../lambdas';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface LicenseRefreshProps {
  readonly configTable: ITable;
  readonly artifactResolver: ICdkArtifactEngine;
  readonly coreDomain: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

export class LicenseRefresh extends Construct {
  /** Exposed for constructs that need to gate on the license function (e.g. McpApi). */
  public readonly licenseFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: LicenseRefreshProps) {
    super(scope, id);

    const handler = new LicenseRefresherLambda(this, 'handler', {
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
      coreDomain: props.coreDomain,
      vendorAccountIds: props.vendorAccountIds,
    });

    this.licenseFunction = handler;

    // Randomized daily refresh time — computed once at synth, unique per deployment
    // to avoid thundering herd across all customer stacks.
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);
    new Rule(this, 'rule', {
      schedule: Schedule.cron({ hour: String(hour), minute: String(minute) }),
      targets: [new LambdaFunction(handler)],
    });

    // Refresh immediately after stack deploy/update completes.
    new Rule(this, 'refresh-on-stack-complete', {
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
