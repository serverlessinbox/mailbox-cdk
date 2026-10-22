import type { IArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda, StackDeployedEvent }  from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }               from 'aws-cdk-lib/aws-iam';
import { Duration }                      from 'aws-cdk-lib';
import { Construct }                     from 'constructs';

import { LicenseRefreshSchedule }        from '../events/license-refresh-schedule';
import type { IDataTable }               from '../tables/data-tables';

export interface LicenseRefresherLambdaProps {
  configTable: IDataTable;
  artifactResolver: IArtifactResolver;
  coreDomain: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** Hour of the daily refresh. */
  readonly scheduleHour: string;
  /** Minute of the daily refresh. */
  readonly scheduleMinute: string;
}

export class LicenseRefresherLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: LicenseRefresherLambdaProps) {
    super(scope, id, {
      lambdaId: 'license-refresher',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        CORE_DOMAIN: props.coreDomain,
      },
    });

    props.configTable.grantReadWrite(this);

    this.grantLicenseApiAccess(props.vendorAccountIds);

    new LicenseRefreshSchedule(this, 'refresh-schedule', { target: this, hour: props.scheduleHour, minute: props.scheduleMinute });
    new StackDeployedEvent(this, 'stack-deployed', this);
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]) {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: vendorAccountIds.map(
        (accountId) => `arn:aws:execute-api:*:${accountId}:*/*/POST/refresh-license`,
      ),
    }));
  }
}
