import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../utils/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface AuthorizerLambdaProps {
  jwkCacheTable: ITable;
  configTable: ITable;
  userPoolIssuer: string;
  artifactResolver: IArtifactResolver;
}

export class AuthorizerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuthorizerLambdaProps) {
    super(scope, id, {
      lambdaId: 'authorizer',
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      environment: {
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        USER_POOL_ISSUER: props.userPoolIssuer,
        AUTH_POLICY_NAME: 'JMAP_API',
        ALLOW_ANONYMOUS: 'true',
      },
    });

    props.jwkCacheTable.grantReadData(this);
    props.configTable.grantReadData(this);
  }
}
