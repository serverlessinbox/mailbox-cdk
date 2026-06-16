import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { IAdminApiAddon } from '@serverlessinbox/mailbox';

import { CognitoIdpUsersApiLambda } from '../lambdas/cognito-idp-users-api';
import type { ICdkArtifactResolver } from '../cdk-resolver';

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
  readonly artifactResolver: ICdkArtifactResolver;

  /** Audit events queue used by the existing audit-writer lambda. */
  readonly auditEventsQueue: IQueue;

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
  private readonly _lambdaConstruct: CognitoIdpUsersApiLambda;

  /** The underlying CDK construct wrapping the Lambda function. */
  public readonly lambdaFunction: Construct;

  constructor(scope: Construct, id: string, props: CognitoIdpUsersAdminApiAddonProps) {
    super(scope, id);

    this.basePath = props.basePath ?? '/idp-users';
    this.uiConfig =
      props.uiConfig ??
      ({
        idp: {
          users: {
            provider: 'cognito',
            basePath: this.basePath,
            features: {
              setPassword: true,
            },
          },
        },
      } as const);

    this._lambdaConstruct = new CognitoIdpUsersApiLambda(this, 'idp-users', {
      artifactResolver: props.artifactResolver,
      userPoolId: props.pool.userPoolId,
      auditEventsQueueUrl: props.auditEventsQueue.queueUrl,
    });
    this.lambdaFunction = this._lambdaConstruct;

    const authz = props.pool.fetchAuthorizationConfig?.();
    if (authz) {
      this._lambdaConstruct.function.addEnvironment('ADMIN_GROUPS', JSON.stringify(authz.adminGroups ?? []));
      this._lambdaConstruct.function.addEnvironment('USER_GROUPS', JSON.stringify(authz.userGroups ?? []));
    }

    props.pool.grantAdminAccess(this._lambdaConstruct.fn);
    props.auditEventsQueue.grantSendMessages(this._lambdaConstruct.fn);
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: `${this.basePath}/{proxy+}`,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('cognito-idp-users', this._lambdaConstruct.fn),
      authorizer,
    });
  }
}
