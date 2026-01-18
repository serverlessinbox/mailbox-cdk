import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { AUTH_POLICY_JMAP_API, AuthPolicyName } from '../auth/types';

export interface AuthorizerLambdaProps {
  jwkCacheTable: ITable;
  configTable: ITable;
  userPoolIssuer: string;
  artifactResolver: IArtifactResolver;

  /** Which auth policy record to load from DynamoDB (e.g. ADMIN_API, JMAP_API). */
  authPolicyName?: AuthPolicyName;

  /** Whether requests without an access token can pass authorization. */
  allowAnonymous?: boolean;
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
        AUTH_POLICY_NAME: props.authPolicyName ?? AUTH_POLICY_JMAP_API,
        ALLOW_ANONYMOUS: (props.allowAnonymous ?? true) ? 'true' : 'false',
      },
    });

    props.jwkCacheTable.grantReadData(this);
    props.configTable.grantReadData(this);
  }
}
