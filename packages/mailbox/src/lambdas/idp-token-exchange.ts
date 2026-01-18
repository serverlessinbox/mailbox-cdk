import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { AuthPolicyName, OAuthClientName } from '../auth/types';

export interface IdpTokenExchangeLambdaProps {
  configTable: ITable;
  authPolicyName?: AuthPolicyName;
  oauthClientName?: OAuthClientName;
  artifactResolver: IArtifactResolver;
}

export class IdpTokenExchangeLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: IdpTokenExchangeLambdaProps) {
    super(scope, id, {
      lambdaId: 'idp-token-exchange',
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUTH_POLICY_NAME: props.authPolicyName ?? 'ADMIN_API',
        OAUTH_CLIENT_NAME: props.oauthClientName ?? 'ADMIN_UI',
      },
    });

    props.configTable.grantReadData(this);
  }
}
