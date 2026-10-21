import type { IArtifactResolver }                                                           from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }                                                 from '@serverlessinbox/mailbox-cdk-shared';
import type * as acm                                                                        from 'aws-cdk-lib/aws-certificatemanager';
import { Construct }                                                                        from 'constructs';

import type { IDataBlobStore }                                                              from '../../resources/buckets/data-blob-store';
import type { IIdentityProvisioner }                                                        from '../../resources/lambdas/identity-provisioner-lambda';
import type { IAuditEventsQueue }                                                           from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                                                          from '../../resources/queues/email-sending-queue';
import type { IAuthKeyStoreTable }                                                          from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                                                  from '../../resources/tables/data-tables';
import type { IMailboxAuthProvider }                                                        from '../auth/types';
import type { IMailboxDomainNames }                                                         from '../domains/mailbox-domains';

import type { AdminApiAddonContext, IAdminApiAddon, IAdminApiAddonProvider, IJmapApiAddon } from './addons';
import { AdminApi }                                                                         from './admin-api';
import { JMapApi }                                                                          from './jmap-api';
import { McpApi }                                                                           from './mcp-api';
import { WebSocketPush }                                                                    from './websocket';
import type { IWebSocketBroadcastPublisher }                                                from './websocket';

/** Props of {@link ApisSection}: what the addons and the API endpoints are built from. */
export interface ApisSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly authProvider: IMailboxAuthProvider;
  /** Further providers of admin-api addons, after the auth provider's own. */
  readonly adminApiAddonProviders?: IAdminApiAddonProvider[];
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly auditLogTable: IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly identityProvisioner: IIdentityProvisioner;
  readonly vendorAccountIds: string[];
  readonly stackIdentityTagKey: string;
  readonly sesRuleSetName: string;
  readonly sesConfigSetName: string;
  readonly domainName: string;
  /** The JMAP API's base URL as the JMAP addons see it. */
  readonly jmapApiBaseUrl: string;
}

/** Props of {@link ApisSection.addEndpoints}: the values that exist only after the UIs and the CDN. */
export interface ApisEndpointsProps {
  /** The base URL of the blob CDN, with protocol. */
  readonly cdnHost: string;
  readonly mailboxDomains: IMailboxDomainNames;
  readonly hasHostedZone: boolean;
  /** Origins allowed to call the admin API cross-origin. */
  readonly adminApiAllowedOrigins: string[];
  /** Origins allowed to call the JMAP API cross-origin. */
  readonly jmapApiAllowedOrigins: string[];
  readonly apiCertificate?: acm.ICertificate;
  readonly jmapCertificate?: acm.ICertificate;
  readonly wsCertificate?: acm.ICertificate;
  /** Present when the MCP API is enabled. */
  readonly mcp?: McpEndpointProps;
}

/** What the MCP API is built from. */
export interface McpEndpointProps {
  /** The regional certificate the MCP API is served with. */
  readonly regionalCertificate: acm.ICertificate;
}

/** What the endpoints built by {@link ApisSection.addEndpoints} offer to the rest of the mail server. */
export interface IApisEndpoints {
  /** The capability to publish changes to connected WebSocket clients. */
  readonly broadcaster: IWebSocketBroadcastPublisher;
  /** CNAME target of the admin API custom domain, when it has one. */
  readonly adminApiDomainTarget?: string;
  /** CNAME target of the JMAP API custom domain, when it has one. */
  readonly jmapApiDomainTarget?: string;
  /** CNAME target of the WebSocket API custom domain, when it has one. */
  readonly webSocketDomainTarget?: string;
  /** CNAME target of the MCP API custom domain, when the MCP API is enabled. */
  readonly mcpApiDomainTarget?: string;
}

/**
 * The admin-API and JMAP-API addons, and the API endpoints themselves. The addons are created at
 * construction because the Admin UI needs their UI configuration; the endpoints need values that
 * exist only after the UIs and the CDN, so they are added by {@link ApisSection.addEndpoints} at
 * that point.
 */
export class ApisSection extends Construct {
  /** The admin-API addons of the auth provider and of the additional providers, in that order. */
  public readonly adminApiAddons: IAdminApiAddon[];

  private readonly props: ApisSectionProps;
  private readonly jmapApiAddons: IJmapApiAddon[];

  constructor(scope: Construct, id: string, props: ApisSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'api');

    this.props = props;

    // Build admin API addons early from all providers (auth provider + optional additional providers).
    // All addons are known at construction time, so uiConfig merge is eager.
    this.adminApiAddons = (() => {
      const addons: IAdminApiAddon[] = [];

      const ctx: AdminApiAddonContext = {
        auditEventsQueue: props.auditEventsQueue,
        configTable: props.configTable,
        auditLogTable: props.auditLogTable,
        identityProvisioner: props.identityProvisioner,
        artifactResolver: props.artifactResolver,
      };

      addons.push(...props.authProvider.createAdminApiAddons(this, ctx));

      for (const provider of props.adminApiAddonProviders ?? []) {
        addons.push(...provider.createAdminApiAddons(this, ctx));
      }

      return addons;
    })();

    this.jmapApiAddons = (() => {
      if (typeof props.authProvider.createJmapApiAddons !== 'function') {return [];}
      return props.authProvider.createJmapApiAddons(this, {
        apiBaseUrl: props.jmapApiBaseUrl,
        identityProvisioner: props.identityProvisioner,
      });
    })();
  }

  /** Adds the JMAP, WebSocket, admin and (when enabled) MCP APIs; their inputs exist only once the UIs and the CDN are built. */
  public addEndpoints(props: ApisEndpointsProps): IApisEndpoints {
    const jmapApi       = this.addJmapApi(props);
    const webSocketPush = this.addWebSocketPush(props, jmapApi);
    const adminApi      = this.addAdminApi(props);
    const mcpApi        = this.addMcpApi(props, jmapApi);

    jmapApi.enableWebSocketPublishing(webSocketPush.webSocketUrl, webSocketPush.broadcaster);
    adminApi.enableWebSocketPublishing(webSocketPush.broadcaster);

    // --- Pin logical IDs to survive reparenting ---
    // API Gateway custom domain names are globally unique per account/region; a reparented
    // construct cannot create the replacement alongside the still-existing original, so
    // create-before-delete would fail on a name collision. Pinning the logical ID keeps
    // CloudFormation updating the same domain name in place instead of replacing it.
    adminApi.domainCfnResource?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    jmapApi.domainCfnResource?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
    webSocketPush.domainCfnResource?.overrideLogicalId('MailboxwebsocketpushdomainCACDAF3B');

    return {
      broadcaster: webSocketPush.broadcaster,
      adminApiDomainTarget: adminApi.domainTarget,
      jmapApiDomainTarget: jmapApi.domainTarget,
      webSocketDomainTarget: webSocketPush.domainTarget,
      mcpApiDomainTarget: mcpApi?.domainTarget,
    };
  }

  private addJmapApi(props: ApisEndpointsProps): JMapApi {
    return new JMapApi(this, 'jmap-api', {
      configTable: this.props.configTable,
      itemTable: this.props.itemTable,
      changelogTable: this.props.changelogTable,
      authKeyStoreTable: this.props.authKeyStoreTable,
      cdnHost: props.cdnHost,
      allowedOrigins: props.jmapApiAllowedOrigins.length > 0 ? props.jmapApiAllowedOrigins : undefined,
      blobStore: this.props.blobStore,
      emailSubmissionQueue: this.props.emailSubmissionQueue,
      auditEventsQueue: this.props.auditEventsQueue,
      artifactResolver: this.props.artifactResolver,
      authProvider: this.props.authProvider,
      identityProvisioner: this.props.identityProvisioner,

      domainName: props.jmapCertificate ? props.mailboxDomains.jmap : undefined,
      certificate: props.jmapCertificate,

      jmapApiAddons: this.jmapApiAddons,
      oauthIssuerUrl: this.props.authProvider.jmapOAuthIssuerUrl?.(),
      vendorAccountIds: this.props.vendorAccountIds,

      // WebSocket URL will be passed via environment variable, not here
    });
  }

  private addWebSocketPush(props: ApisEndpointsProps, jmapApi: JMapApi): WebSocketPush {
    // Created after the JMAP API because it reuses that API's authorizer Lambda.
    const webSocketPush = new WebSocketPush(this, 'websocket-push', {
      configTable: this.props.configTable,
      itemTable: this.props.itemTable,
      changelogTable: this.props.changelogTable,
      authorizerLambda: jmapApi.authorizerLambda, // Reuse HTTP API authorizer
      artifactResolver: this.props.artifactResolver,
      maxSubscriptions: 10,

      domainName: (props.hasHostedZone && props.wsCertificate) ? props.mailboxDomains.ws : undefined,
      certificate: props.hasHostedZone ? props.wsCertificate : undefined,
    });
    // Keep a deeper messaging override — websocket-push overrides the apis group tag.
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');

    return webSocketPush;
  }

  private addAdminApi(props: ApisEndpointsProps): AdminApi {
    return new AdminApi(this, 'admin-api', {
      configTable: this.props.configTable,
      itemTable: this.props.itemTable,
      auditLogTable: this.props.auditLogTable,
      changelogTable: this.props.changelogTable,
      mailFeedbackTable: this.props.mailFeedbackTable,
      authKeyStoreTable: this.props.authKeyStoreTable,
      blobStore: this.props.blobStore,
      emailSubmissionQueue: this.props.emailSubmissionQueue,
      auditEventsQueue: this.props.auditEventsQueue,
      allowedOrigins: props.adminApiAllowedOrigins.length > 0 ? props.adminApiAllowedOrigins : undefined,
      artifactResolver: this.props.artifactResolver,
      identityProvisioner: this.props.identityProvisioner,
      vendorAccountIds: this.props.vendorAccountIds,
      stackIdentityTagKey: this.props.stackIdentityTagKey,

      addons: this.adminApiAddons,

      domainName: props.apiCertificate ? props.mailboxDomains.api : undefined,
      certificate: props.apiCertificate,

      sesRuleSetName: this.props.sesRuleSetName,
      sesConfigSetName: this.props.sesConfigSetName,
      systemSenderAddress: `noreply@${this.props.domainName}`,
    });
  }

  private addMcpApi(props: ApisEndpointsProps, jmapApi: JMapApi): McpApi | undefined {
    return props.mcp ? new McpApi(this, 'mcp-api', {
      jmapApiGateway: jmapApi.httpApi,
      authorizerLambda: jmapApi.authorizerLambda,
      certificate: props.mcp.regionalCertificate,
      domainName: this.props.domainName,
      scopeMap: this.props.authProvider.scopeMap as Record<string, string[]>,
      artifactResolver: this.props.artifactResolver,
    }) : undefined;
  }
}
