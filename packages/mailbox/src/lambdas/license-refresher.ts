import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { resolveVendorAccountIds } from '../addons/support-roles-infra';

export interface LicenseRefresherLambdaProps {
  configTable: ITable;
  artifactResolver: ICdkArtifactEngine;
  coreDomain: string;
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
        INSTANCE_ID: Aws.STACK_NAME,
        CORE_DOMAIN: props.coreDomain,
      },
    });

    props.configTable.grantReadWriteData(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: resolveVendorAccountIds().map(
        (accountId) => `arn:aws:execute-api:*:${accountId}:*/*/POST/refresh-license`,
      ),
    }));
  }
}
