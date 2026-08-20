import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AUTH_POLICY_JMAP_API, AuthPolicyName } from '../auth/types';

export interface AuthorizerLambdaProps {
  authKeyStoreTable: ITable;
  configTable: ITable;
  userPoolIssuer: string;
  artifactResolver: ICdkArtifactEngine;

  /** Which auth policy record to load from DynamoDB (e.g. ADMIN_API, JMAP_API). */
  authPolicyName?: AuthPolicyName;

  /** Comma-separated list of API Gateway route keys (e.g. 'GET /.well-known/jmap') that allow anonymous access. */
  anonymousRoutes?: string[];
}

export class AuthorizerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuthorizerLambdaProps) {
    super(scope, id, {
      lambdaId: 'authorizer',
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        USER_POOL_ISSUER: props.userPoolIssuer,
        AUTH_POLICY_NAME: props.authPolicyName ?? AUTH_POLICY_JMAP_API,
        ALLOW_ANONYMOUS_ROUTES: (props.anonymousRoutes ?? []).join(','),
        TENANT_RESOLUTION_MODE: '',
      },
    });

    props.authKeyStoreTable.grantReadData(this);
    props.configTable.grantReadData(this);
  }
}
