import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import type { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';
import type { IDataTable } from '../data/data-tables';

export interface IAdminApiAddon {
  /** Mount additional routes on the Admin API behind the same authorizer. */
  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void;

  /** Optional UI config fragment to be merged into the Admin UI `/config/config.json`. */
  uiConfig?: Record<string, unknown>;
}

/**
 * Data an admin-api addon may need to build its own Lambda: the audit-events queue to send audit
 * records to, and the config/audit-log tables most addons read from. Passed to every
 * {@link IAdminApiAddonProvider.createAdminApiAddons} call so a capability (support, stack-update, a
 * Cognito user-management addon, and any consumer-supplied addon) does not have to reach into
 * `Mailbox` internals to get them.
 */
export interface AdminApiAddonContext {
  /**
   * Send-only handle to the shared audit-events queue. Pass this straight through to your addon's
   * Lambda props and call `grantSend(this)` inside that Lambda's own constructor — never grant on
   * this queue from outside the Lambda that holds it.
   */
  readonly auditEventsQueue: IAuditEventsQueue;
  /** Shared config table (accounts, aliases, settings) most addons read from. */
  readonly configTable: IDataTable;
  /** Shared audit-log table, for addons that need to read past audit records (not for writing —
   *  writes go through {@link auditEventsQueue} and the dedicated audit-writer consumer). */
  readonly auditLogTable: IDataTable;
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

