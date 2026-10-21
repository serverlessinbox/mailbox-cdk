import type { IArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import type { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { HttpApi }              from 'aws-cdk-lib/aws-apigatewayv2';
import type { Construct }            from 'constructs';

import type { IDataTable }           from '../data/data-tables';
import type { IAuditEventsQueue }    from '../features/audit-writing/audit-events-queue';
import type { IIdentityProvisioner } from '../resources/lambdas/identity-provisioner-lambda';

/**
 * A capability that extends the Admin API with extra routes and, optionally, Admin UI
 * configuration. Implement it, and return it from an {@link IAdminApiAddonProvider}, to add your
 * own endpoints to the Admin API.
 */
export interface IAdminApiAddon {
  /**
   * Mounts the addon's routes on the Admin API.
   *
   * Pass `authorizer` to every route you add so it is protected like the other Admin API routes.
   *
   * @param api The Admin API's HTTP API to add routes to.
   * @param authorizer The authorizer that protects every other Admin API route.
   */
  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void;

  /**
   * Configuration this addon contributes to the Admin UI's runtime `config/config.json`, for
   * example a flag that tells the UI the capability is present.
   *
   * The top-level keys of every addon are merged into one object, in addon order, so a later
   * addon overwrites an earlier one that uses the same key: choose keys specific to your
   * addon. The merge happens only when the Admin UI is enabled.
   *
   * @default - the addon contributes no UI configuration
   */
  uiConfig?: Record<string, unknown>;
}

/**
 * What an admin-api addon needs to build its own Lambda: the audit-events queue, the shared
 * config and audit-log tables, the identity provisioner and the artifact resolver. Passed to
 * every {@link IAdminApiAddonProvider.createAdminApiAddons} call so an addon does not have to
 * reach into `Mailbox` internals to get them.
 */
export interface AdminApiAddonContext {
  /**
   * Send-only handle to the shared audit-events queue. Pass this straight through to your addon's
   * Lambda props and call `grantSend(this)` inside that Lambda's own constructor — never grant on
   * this queue from outside the Lambda that holds it.
   */
  readonly auditEventsQueue: IAuditEventsQueue;
  /**
   * Shared config table (accounts, aliases, settings). Pass it to your addon's Lambda props and
   * grant the Lambda access inside its own constructor.
   */
  readonly configTable: IDataTable;
  /**
   * Shared audit-log table, for reading past audit records. Do not write to it: record audit
   * events by sending them to {@link auditEventsQueue}.
   */
  readonly auditLogTable: IDataTable;
  /**
   * Handle to the shared `identity-provisioner` Lambda. Pass this straight through to your
   * addon's Lambda props and call `grantInvoke(this)` inside that Lambda's own constructor —
   * never grant from outside the Lambda that holds it.
   */
  readonly identityProvisioner: IIdentityProvisioner;
  /**
   * The artifact resolver the Mailbox resolves its own artifacts with: the one injected through
   * `MailboxProps.artifactResolver`, or the Mailbox's default pinned resolver when none was
   * injected. Resolve your addon's Lambda code through this so it ships at the same artifact
   * version as the rest of the Mailbox, instead of asking the consumer for a second resolver.
   */
  readonly artifactResolver: IArtifactResolver;
}

/**
 * A capability that extends the JMAP API with extra routes. Return it from an auth provider's
 * `createJmapApiAddons` to add your own endpoints to the JMAP API.
 */
export interface IJmapApiAddon {
  /**
   * Mounts the addon's routes directly on the JMAP API's HTTP API.
   *
   * Unlike Admin API addons, JMAP addons do not receive the JMAP API's authorizer: the addon's
   * Lambda is responsible for gating its own routes if they need gating.
   *
   * @param api The JMAP API's HTTP API to add routes to.
   */
  addRoutes(api: HttpApi): void;
}

/**
 * What a JMAP API addon needs to build its routes: the API's public base URL and the identity
 * provisioner.
 */
export interface JmapApiAddonContext {
  /**
   * Base URL of the JMAP API, `https://` followed by its host, without a trailing slash. The host
   * is derived at deploy time, so the value is an unresolved token at synth time: build URLs from
   * it by concatenation and do not parse it.
   */
  readonly apiBaseUrl: string;
  /** Handle to the shared `identity-provisioner` Lambda, for routes that provision identities. */
  readonly identityProvisioner: IIdentityProvisioner;
}

/**
 * Contributes Admin API addons: extra routes and Admin UI configuration. Implement it to add a
 * capability to the Admin API without changing the core package.
 */
export interface IAdminApiAddonProvider {
  /**
   * Creates the addons this provider contributes.
   *
   * Create every construct of the addon under `scope`, not under another parent, so it sits with
   * the other API resources.
   *
   * @param scope The construct to create the addon's resources under.
   * @param ctx The shared tables, queue, provisioner and artifact resolver the addon builds on.
   */
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): IAdminApiAddon[];
}

