import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { IAdminApiAddon, type IAuditEventsQueue, type IIdentityProvisioner } from '@serverlessinbox/mailbox';

import { CognitoIdpUsersApiLambda } from '../lambdas/cognito-idp-users-api';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface CognitoIdpUsersAuthorizationConfig {
  readonly adminGroups: string[];
  readonly userGroups: string[];
}

export interface ICognitoIdpUsersPoolConfig {
  readonly userPoolId: string;
  grantAdminAccess(fn: IFunction): void;
  fetchAuthorizationConfig?(): CognitoIdpUsersAuthorizationConfig;
}

export interface CognitoIdpUsersAdminApiAddonProps {
  /** Artifact resolver — provided by MailboxUserPool, not created independently. */
  readonly artifactResolver: ICdkArtifactEngine;

  /** Audit events queue used by the existing audit-writer lambda. */
  readonly auditEventsQueue: IAuditEventsQueue;

  /** Handle to the shared `identity-provisioner` Lambda, threaded through to the addon's own
   *  Lambda so it can pre-provision a mailbox principal at user-creation time. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** Cognito pool integration (used for pool id + granting permissions). */
  readonly pool: ICognitoIdpUsersPoolConfig;

  /** Optional base path; defaults to `/idp-users`. */
  readonly basePath?: string;

  /** Optional UI config to be merged into admin-ui config.json. */
  readonly uiConfig?: Record<string, unknown>;
}

/**
 * Mounts a Cognito-specific IdP user management API under the main Admin API.
 *
 * Routes: `${basePath}/{proxy+}` (ANY)
 *
 * The actual handler logic lives in a provider-owned Lambda (TypeScript/Node.js, artifact-based).
 */
export class CognitoIdpUsersAdminApiAddon extends Construct implements IAdminApiAddon {
  public readonly basePath: string;
  public uiConfig?: Record<string, unknown>;

  /** @internal */
  private readonly lambdaConstruct: CognitoIdpUsersApiLambda;

  /** The underlying Lambda function. */
  public readonly lambdaFunction: IFunction;

  constructor(scope: Construct, id: string, props: CognitoIdpUsersAdminApiAddonProps) {
    super(scope, id);

    this.basePath = props.basePath ?? '/idp-users';
    // Build this addon's derived users config with the actual basePath it resolved
    const derivedUsersConfig = {
      idp: {
        users: {
          provider: 'cognito' as const,
          basePath: this.basePath,
          features: {
            setPassword: true,
          },
        },
      },
    };

    // Deep-merge with the provided uiConfig (if any), giving this addon's users fragment priority
    if (props.uiConfig) {
      // Merge at the idp level: preserve any top-level keys from props.uiConfig,
      // and merge its idp config with our derived users config
      const providerIdpConfig = (props.uiConfig.idp as Record<string, unknown>) ?? {};
      this.uiConfig = {
        ...props.uiConfig,
        idp: {
          ...providerIdpConfig,
          ...derivedUsersConfig.idp,
        },
      };
    } else {
      this.uiConfig = derivedUsersConfig;
    }

    const authz = props.pool.fetchAuthorizationConfig?.();
    this.lambdaConstruct = new CognitoIdpUsersApiLambda(this, 'idp-users', {
      artifactResolver: props.artifactResolver,
      userPoolId: props.pool.userPoolId,
      auditEventsQueue: props.auditEventsQueue,
      identityProvisioner: props.identityProvisioner,
      pool: props.pool,
      adminGroups: authz ? JSON.stringify(authz.adminGroups ?? []) : undefined,
      userGroups: authz ? JSON.stringify(authz.userGroups ?? []) : undefined,
    });
    this.lambdaFunction = this.lambdaConstruct;
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: `${this.basePath}/{proxy+}`,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('cognito-idp-users', this.lambdaConstruct),
      authorizer,
    });
  }
}
