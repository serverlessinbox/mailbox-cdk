import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StackHelpers } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../../data/data-tables';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { LicenseRefresherLambda } from '../../lambdas';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

/** Inputs of the license refresher Lambda and of the rules that invoke it. */
export interface LicenseRefreshProps {
  readonly configTable: IDataTable;
  readonly artifactResolver: IArtifactResolver;
  readonly coreDomain: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/**
 * The license refresher Lambda together with the rules that invoke it: once a day, and after every
 * stack create or update.
 */
export class LicenseRefresh extends Construct {
  /** The Lambda function that refreshes the license. */
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

    // The time differs per install so that customer stacks do not all refresh at once.
    const dailySchedule = StackHelpers.getOrCreate(this, props.artifactResolver).resolveDailySchedule(this, 'schedule');
    new Rule(this, 'rule', {
      schedule: Schedule.cron({ hour: dailySchedule.hour, minute: dailySchedule.minute }),
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
