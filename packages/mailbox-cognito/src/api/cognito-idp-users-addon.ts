import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { AdminApiAddon, IArtifactResolver } from '@serverlessinbox/mailbox';

import { CognitoIdpUsersApiLambda } from '../lambdas/cognito-idp-users-api';

export interface CognitoIdpUsersAdminApiAddonProps {
  artifactResolver: IArtifactResolver;

  /** Audit events queue used by the existing audit-writer lambda. */
  auditEventsQueue: IQueue;

  /** Cognito pool integration (used for pool id + granting permissions). */
  pool: {
    userPoolId: string;
    grantAdminAccess(fn: IFunction): void;
    getAuthorizationConfig?(): { adminGroups: string[]; userGroups: string[] };
  };

  /** Optional base path; defaults to `/idp-users`. */
  basePath?: string;

  /** Optional UI config to be merged into admin-ui config.json. */
  uiConfig?: Record<string, unknown>;
}

/**
 * Mounts a Cognito-specific IdP user management API under the main Admin API.
 *
 * Routes: `${basePath}/{proxy+}` (ANY)
 *
 * The actual handler logic lives in a provider-owned Lambda (TypeScript/Node.js, artifact-based).
 */
export class CognitoIdpUsersAdminApiAddon extends Construct implements AdminApiAddon {
  public readonly basePath: string;
  public readonly uiConfig?: Record<string, unknown>;

  public readonly lambda: CognitoIdpUsersApiLambda;

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

    this.lambda = new CognitoIdpUsersApiLambda(this, 'idp-users', {
      artifactResolver: props.artifactResolver,
      userPoolId: props.pool.userPoolId,
      auditEventsQueueUrl: props.auditEventsQueue.queueUrl,
    });

    const authz = props.pool.getAuthorizationConfig?.();
    if (authz) {
      this.lambda.function.addEnvironment('ADMIN_GROUPS', JSON.stringify(authz.adminGroups ?? []));
      this.lambda.function.addEnvironment('USER_GROUPS', JSON.stringify(authz.userGroups ?? []));
    }

    props.pool.grantAdminAccess(this.lambda.fn);
    props.auditEventsQueue.grantSendMessages(this.lambda.fn);
  }

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: `${this.basePath}/{proxy+}`,
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('cognito-idp-users', this.lambda.fn),
      authorizer,
    });
  }
}
