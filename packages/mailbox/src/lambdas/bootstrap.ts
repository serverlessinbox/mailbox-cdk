import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface BootstrapLambdaProps {
  configTable: ITable;
  jwkCacheTable: ITable;
  authKeyStoreTable: ITable;
  artifactResolver: ICdkArtifactResolver;
}

export class BootstrapLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapLambdaProps) {
    super(scope, id, {
      lambdaId: 'bootstrap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
      },
    });

    // Allow the bootstrap custom resource to ensure Service Quotas prerequisites are available.
    // This is expected to run at stack install time; runtime APIs should not need this permission.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        'iam:CreateServiceLinkedRole',
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:AWSServiceName': 'servicequotas.amazonaws.com',
        },
      },
    }));

    props.configTable.grantReadWriteData(this);
    props.jwkCacheTable.grantReadWriteData(this);
    props.authKeyStoreTable.grantReadWriteData(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*'],
    }));
  }
}
