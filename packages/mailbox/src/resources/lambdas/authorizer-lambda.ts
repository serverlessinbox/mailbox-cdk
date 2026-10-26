import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                             from '@serverlessinbox/mailbox-cdk-shared';
import type { Pipeline }                        from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                             from 'aws-cdk-lib';
import { Construct }                            from 'constructs';

import type { AuthPolicyName }                  from '../../contracts/auth-names';
import type { IAuthKeyStoreTable }              from '../tables/auth-key-store-table';
import type { IDataTable }                      from '../tables/data-tables';

/**
 * The key store and config tables the authorizer reads, the auth policy and anonymous routes it
 * applies, and the service name and pipeline that identify this instance. The caller creates the
 * tables and chooses the policy.
 */
export interface AuthorizerLambdaProps {
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly configTable:       IDataTable;
  readonly artifactResolver:  IArtifactResolver;

  /** Which auth policy record to load from DynamoDB (e.g. ADMIN_API, JMAP_API). */
  readonly authPolicyName: AuthPolicyName;

  /** API Gateway route keys (e.g. 'GET /.well-known/jmap') that allow anonymous access; the function receives them comma-separated. */
  readonly anonymousRoutes?: string[];

  /** When true, the function resolves the principal and returns it in the authorizer context; absent or false leaves it off. The function always receives the setting, as `on` or `off`. */
  readonly principalLookup?: boolean;

  /** SERVICE_NAME for this physical function; distinguishes it from other AuthorizerLambda instances sharing the 'authorizer' lambdaId. */
  readonly serviceName: string;

  /** This one code site is instantiated for both admin-api ('admin') and jmap-api ('jmap'); the caller states which. */
  readonly pipeline: Pipeline;
}

/**
 * The Go Lambda that authorizes API requests against the policy record named by `authPolicyName`.
 * The routes it lets through anonymously come from the caller.
 */
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
        PRINCIPAL_LOOKUP:          props.principalLookup ? 'on' : 'off',
      },
    });

    props.authKeyStoreTable.grantRead(this);
    props.configTable.grantRead(this);
  }
}
