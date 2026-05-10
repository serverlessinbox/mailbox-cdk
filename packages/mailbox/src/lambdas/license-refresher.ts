import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';

export interface LicenseRefresherLambdaProps {
  configTable: ITable;
  artifactResolver: IArtifactResolver;
}

export class LicenseRefresherLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: LicenseRefresherLambdaProps) {
    super(scope, id, {
      lambdaId: 'license-refresher',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        INSTANCE_ID: Aws.STACK_NAME,
      },
    });

    props.configTable.grantReadWriteData(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*'],
    }));
  }
}
