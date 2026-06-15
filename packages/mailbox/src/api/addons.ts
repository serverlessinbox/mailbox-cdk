import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import type { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export interface IAdminApiAddon {
  /** Mount additional routes on the Admin API behind the same authorizer. */
  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void;

  /** Optional UI config fragment to be merged into the Admin UI `/config/config.json`. */
  uiConfig?: Record<string, unknown>;
}


export interface AdminApiAddonContext {
  readonly auditEventsQueue: IQueue;
}

/**
 * Optional capability for an auth provider implementation (e.g. Cognito) to register
 * additional Admin API routes without the core package knowing provider specifics.
 */
export interface IAdminApiAddonProvider {
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[];
}

