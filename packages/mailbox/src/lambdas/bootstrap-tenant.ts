import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../utils/artifact-resolver';

export interface BootstrapTenantLambdaProps {
  configTable: ITable;
  artifactResolver: IArtifactResolver;
}

export class BootstrapTenantLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapTenantLambdaProps) {
    super(scope, id, {
      lambdaId: 'bootstrap-tenant',
      artifactResolver: props.artifactResolver,
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
      },
    });

    props.configTable.grantReadWriteData(this);
  }
}
