import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                             from '@serverlessinbox/mailbox-cdk-shared';
import type { Pipeline }                        from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                             from 'aws-cdk-lib';
import { Construct }                            from 'constructs';

import type { AuthPolicyName }                  from '../../core/auth/types';
import type { IAuthKeyStoreTable }              from '../tables/auth-key-store-table';
import type { IDataTable }                      from '../tables/data-tables';

export interface AuthorizerLambdaProps {
  authKeyStoreTable: IAuthKeyStoreTable;
  configTable:       IDataTable;
  artifactResolver:  IArtifactResolver;

  /** Which auth policy record to load from DynamoDB (e.g. ADMIN_API, JMAP_API). */
  authPolicyName: AuthPolicyName;

  /** API Gateway route keys (e.g. 'GET /.well-known/jmap') that allow anonymous access; the function receives them comma-separated. */
  anonymousRoutes?: string[];

  /** SERVICE_NAME for this physical function; distinguishes it from other AuthorizerLambda instances sharing the 'authorizer' lambdaId. */
  serviceName: string;

  /** This one code site is instantiated for both admin-api ('admin') and jmap-api ('jmap'); the caller states which. */
  readonly pipeline: Pipeline;
}

export class AuthorizerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuthorizerLambdaProps) {
    super(scope, id, {
      lambdaId:         'authorizer',
      pipeline:         props.pipeline,
      serviceName:      props.serviceName,
      artifactResolver: props.artifactResolver,
      memorySize:       256,
      timeout:          Duration.seconds(30),
      environment:      {
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        CONFIG_TABLE_NAME:         props.configTable.tableName,
        AUTH_POLICY_NAME:          props.authPolicyName,
        ALLOW_ANONYMOUS_ROUTES:    (props.anonymousRoutes ?? []).join(','),
      },
    });

    props.authKeyStoreTable.grantRead(this);
    props.configTable.grantRead(this);
  }
}
