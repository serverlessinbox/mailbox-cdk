import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import type { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export interface IAdminApiAddon {
  /** Mount additional routes on the Admin API behind the same authorizer. */
  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void;

  /** Optional UI config fragment to be merged into the Admin UI `/config/config.json`. */
  uiConfig?: Record<string, unknown>;
}

export interface AdminApiAddonContext {
  readonly auditEventsQueue: IQueue;
  readonly configTable: ITable;
  readonly auditLogTable: ITable;
}

export interface IJmapApiAddon {
  /** Mount additional routes directly on the JMAP API's HttpApi. Unlike Admin API addons, JMAP
   *  addons do not share jmap-api's authorizer — each addon Lambda is
   *  responsible for gating its own routes if it needs to. */
  addRoutes(api: HttpApi): void;
}

export interface JmapApiAddonContext {
  readonly apiBaseUrl: string;
  /** The `identity-provisioner` Lambda, e.g. for `JmapOAuthAddon`'s DCR route. */
  readonly identityProvisionerFunction: IFunction;
}

/**
 * Provider for contributing admin-api routes and UI configuration.
 * Both auth providers (e.g. Cognito) and other capabilities (e.g. Update addon)
 * implement this to register their Admin API routes and UI config without
 * the core package knowing capability-specific details.
 */
export interface IAdminApiAddonProvider {
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[];
}

