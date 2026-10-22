import type { IArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, StackHelpers } from '@serverlessinbox/mailbox-cdk-shared';
import * as lambda                            from 'aws-cdk-lib/aws-lambda';
import { Construct }                          from 'constructs';

import { LicenseRefresherLambda }             from '../../resources/lambdas/license-refresher-lambda';
import type { IDataTable }                    from '../../resources/tables/data-tables';

/** Inputs of the license refresher Lambda. */
export interface LicenseRefreshProps {
  readonly configTable: IDataTable;
  readonly artifactResolver: IArtifactResolver;
  readonly coreDomain: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/** The license refresher Lambda, which refreshes once a day and after every stack create or update. */
export class LicenseRefresh extends Construct {
  /** The Lambda function that refreshes the license. */
  public readonly licenseFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: LicenseRefreshProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Periodically refreshes the product license from the license server.');

    // The time differs per install so that customer stacks do not all refresh at once.
    const stackHelpers = StackHelpers.getOrCreate(this, props.artifactResolver);
    const hour         = stackHelpers.resolveSeededNumber(this, 'schedule-hour', { salt: 'license-refresh-hour', range: 24 });
    const minute       = stackHelpers.resolveSeededNumber(this, 'schedule-minute', { salt: 'license-refresh-minute', range: 60 });

    this.licenseFunction = new LicenseRefresherLambda(this, 'handler', {
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
      coreDomain: props.coreDomain,
      vendorAccountIds: props.vendorAccountIds,
      scheduleHour: hour,
      scheduleMinute: minute,
    });
  }
}
