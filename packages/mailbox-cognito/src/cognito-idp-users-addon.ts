import type { IArtifactResolver }                                            from '@serverlessinbox/artifact-registry-cdk';
import { IAdminApiAddon, type IAuditEventsQueue, type IIdentityProvisioner } from '@serverlessinbox/mailbox';
import { HttpLambdaAuthorizer }                                              from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }                                             from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpApi, HttpMethod }                                               from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                                                    from 'aws-cdk-lib/aws-lambda';
import { Construct }                                                         from 'constructs';

import type { ICognitoIdpUsersPoolConfig }                                   from './cognito-idp-users-pool-config';
import { CognitoIdpUsersApiLambda }                                          from './resources/lambdas/cognito-idp-users-api-lambda';

/** What `CognitoIdpUsersAdminApiAddon` needs to mount the users API and create the Lambda behind it. */
export interface CognitoIdpUsersAdminApiAddonProps {
  /** Resolves the code artifact of the users API Lambda. */
  readonly artifactResolver: IArtifactResolver;

  /** The queue the users API Lambda sends its audit events to. */
  readonly auditEventsQueue: IAuditEventsQueue;

  /** The `identity-provisioner` Lambda the users API Lambda invokes to pre-provision a mailbox principal when it creates a user. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** The user pool to manage: its id and the grant of administrative access to the Lambda. */
  readonly pool: ICognitoIdpUsersPoolConfig;

  /** The path the API is mounted under; defaults to `/idp-users`. */
  readonly basePath?: string;

  /** UI config merged into the admin UI config; the `idp.users` fragment of this addon takes precedence. */
  readonly uiConfig?: Record<string, unknown>;
}

/** The `idp.users` fragment of the admin UI config: where the users API is mounted and what it supports. */
type IdpUsersUiConfig = {
  readonly idp: {
    readonly users: {
      readonly provider: 'cognito';
      readonly basePath: string;
      readonly features: { readonly setPassword: boolean };
    };
  };
};

const DEFAULT_BASE_PATH = '/idp-users';

/**
 * Mounts a Cognito-specific IdP user management API under the main Admin API.
 *
 * Routes: `${basePath}/{proxy+}` (POST)
 */
export class CognitoIdpUsersAdminApiAddon extends Construct implements IAdminApiAddon {
  public readonly basePath: string;
  public uiConfig?: Record<string, unknown>;

  /** The underlying Lambda function. */
  public readonly lambdaFunction: IFunction;

  constructor(scope: Construct, id: string, props: CognitoIdpUsersAdminApiAddonProps) {
    super(scope, id);

    this.basePath = props.basePath ?? DEFAULT_BASE_PATH;
    this.uiConfig = this.mergeUiConfig(props.uiConfig);

    const authorization = props.pool.authorizationConfig?.();
    this.lambdaFunction = new CognitoIdpUsersApiLambda(this, 'idp-users', {
      artifactResolver:    props.artifactResolver,
      auditEventsQueue:    props.auditEventsQueue,
      identityProvisioner: props.identityProvisioner,
      pool:                props.pool,
      adminGroups:         authorization?.adminGroups,
      userGroups:          authorization?.userGroups,
    });
  }

  public addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path:        `${this.basePath}/{proxy+}`,
      methods:     [HttpMethod.POST],
      integration: new HttpLambdaIntegration('cognito-idp-users', this.lambdaFunction),
      authorizer,
    });
  }

  /** The `idp.users` fragment of this addon wins over the same keys of `providerUiConfig`, which is otherwise kept as given. */
  private mergeUiConfig(providerUiConfig: Record<string, unknown> | undefined): IdpUsersUiConfig | Record<string, unknown> {
    const usersUiConfig: IdpUsersUiConfig = {
      idp: { users: { provider: 'cognito', basePath: this.basePath, features: { setPassword: true } } },
    };
    if (!providerUiConfig) {
      return usersUiConfig;
    }
    return { ...providerUiConfig, idp: Object.assign({}, providerUiConfig.idp, usersUiConfig.idp) };
  }
}
