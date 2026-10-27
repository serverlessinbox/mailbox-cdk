import type { IArtifactResolver }                                                           from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }                                                 from '@serverlessinbox/mailbox-cdk-shared';
import type { VendorLink }                                                                  from '@serverlessinbox/mailbox-cdk-shared';
import type * as acm                                                                        from 'aws-cdk-lib/aws-certificatemanager';
import { Construct }                                                                        from 'constructs';

import type { IWebSocketBroadcastPublisher }                                                from '../../contracts/websocket-push';
import type { IDataBlobStore }                                                              from '../../resources/buckets/data-blob-store';
import type { IIdentityProvisioner }                                                        from '../../resources/lambdas/identity-provisioner-lambda';
import type { IAuditEventsQueue }                                                           from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                                                          from '../../resources/queues/email-sending-queue';
import type { IAuthKeyStoreTable }                                                          from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                                                  from '../../resources/tables/data-tables';
import type { IMailboxAuthProvider }                                                        from '../auth/auth-provider';
import type { ScopeMap }                                                                    from '../auth/jmap-scopes';
import type { IMailboxDomainNames }                                                         from '../domains/mailbox-domains';

import type { AdminApiAddonContext, IAdminApiAddon, IAdminApiAddonProvider, IJmapApiAddon } from './addons';
import { AdminApi }                                                                         from './admin-api';
import type { ApiCustomDomainProps }                                                        from './api-custom-domain';
import { ApiGateway }                                                                       from './api-gateway';
import { JmapApi }                                                                          from './jmap-api';
import { McpApi }                                                                           from './mcp-api';
import { UserApi }                                                                          from './user-api';
import { WebSocketPush }                                                                    from './websocket';

/** What {@link ApisSection} uses of the data section. */
export interface IApisDataInputs {
  readonly configTable:       IDataTable;
  readonly itemTable:         IDataTable;
  readonly changelogTable:    IDataTable;
  readonly auditLogTable:     IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly blobStore:         IDataBlobStore;
  readonly auditEventsQueue:  IAuditEventsQueue;
}

/** What {@link ApisSection} uses of the auth section. */
export interface IApisAuthInputs {
  readonly authKeyStoreTable:   IAuthKeyStoreTable;
  readonly identityProvisioner: IIdentityProvisioner;
}

/** What {@link ApisSection} uses of the email section. */
export interface IApisEmailInputs {
  readonly submissionQueue:  IEmailSendingQueue;
  readonly sesRuleSetName:   string;
  readonly sesConfigSetName: string;
}

/** What {@link ApisSection.addEndpoints} uses of the edge section. */
export interface IApisEdgeInputs {
  readonly apiCertificate?:  acm.ICertificate;
  readonly jmapCertificate?: acm.ICertificate;
  /** Present only when the mailbox has a hosted zone: the WebSocket API gets a custom domain only then. */
  readonly wsCertificate?:   acm.ICertificate;
  /** The certificate the MCP API is served with; absent when the edge section created none. */
  readonly regionalCertificate?: acm.ICertificate;
}

/** What {@link ApisSection.addEndpoints} uses of the ui section. */
export interface IApisUiInputs {
  /** Origins the Admin UI is served from; empty when it is disabled. */
  readonly adminUiOrigins: string[];
  /** Origins the Webmail UI is served from; empty when it is disabled. */
  readonly webmailUiOrigins: string[];
}

/** Props of {@link ApisSection}: what the addons and the API endpoints are built from. */
export interface ApisSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly authProvider:     IMailboxAuthProvider;
  /** Further providers of admin-api addons, after the auth provider's own. */
  readonly adminApiAddonProviders?: IAdminApiAddonProvider[];
  readonly data:                    IApisDataInputs;
  readonly auth:                    IApisAuthInputs;
  readonly email:                   IApisEmailInputs;
  readonly vendorLink:              VendorLink;
  /** The JMAP API's base URL as the JMAP addons see it. */
  readonly jmapApiBaseUrl: string;
}

/**
 * Props of {@link ApisSection.addEndpoints}: the values that exist only after the UIs and the CDN, and the
 * section inputs the endpoints are built from.
 */
export interface ApisEndpointsProps {
  readonly artifactResolver: IArtifactResolver;
  readonly authProvider:     IMailboxAuthProvider;
  readonly data:             IApisDataInputs;
  readonly auth:             IApisAuthInputs;
  readonly email:            IApisEmailInputs;
  readonly vendorLink:       VendorLink;
  /** The base URL of the blob CDN, with protocol. */
  readonly cdnHost:        string;
  readonly mailboxDomains: IMailboxDomainNames;
  readonly edge:           IApisEdgeInputs;
  readonly ui:             IApisUiInputs;
  /** Origins allowed to call the admin API and the JMAP API cross-origin, besides the UIs'. */
  readonly extraAllowedOrigins?: string[];
  /** Whether to add the MCP API; it needs the edge section's regional certificate. */
  readonly enableMcp?: boolean;
}

/** What the endpoints built by {@link ApisSection.addEndpoints} offer to the rest of the mail server. */
export interface IApisEndpoints {
  /** The capability to publish changes to connected WebSocket clients. */
  readonly broadcaster: IWebSocketBroadcastPublisher;
  /** CNAME target of the shared API's custom domain, when it has one. */
  readonly apiDomainTarget?: string;
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

  private readonly jmapApiAddons: IJmapApiAddon[];

  constructor(scope: Construct, id: string, props: ApisSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'api');

    const context: AdminApiAddonContext = {
      auditEventsQueue:    props.data.auditEventsQueue,
      configTable:         props.data.configTable,
      auditLogTable:       props.data.auditLogTable,
      identityProvisioner: props.auth.identityProvisioner,
      artifactResolver:    props.artifactResolver,
    };

    this.adminApiAddons = this.createAdminApiAddons(props.authProvider, props.adminApiAddonProviders ?? [], context);
    this.jmapApiAddons  = this.createJmapApiAddons(props.authProvider, props.jmapApiBaseUrl, props.auth.identityProvisioner);
  }

  /** Adds the JMAP, WebSocket, admin, user and (when enabled) MCP APIs; their inputs exist only once the UIs and the CDN are built. */
  public addEndpoints(props: ApisEndpointsProps): IApisEndpoints {
    const gateway = this.addApiGateway(
      props.ui.adminUiOrigins,
      props.ui.webmailUiOrigins,
      props.extraAllowedOrigins,
      props.mailboxDomains.api,
      props.edge.apiCertificate,
    );

    const jmapApi = this.addJmapApi(
      props.cdnHost,
      [...props.ui.webmailUiOrigins, ...(props.extraAllowedOrigins ?? [])],
      props.edge.jmapCertificate ? { domainName: props.mailboxDomains.jmap, certificate: props.edge.jmapCertificate } : undefined,
      props.data,
      props.auth,
      props.email,
      props.artifactResolver,
      props.authProvider,
      props.vendorLink.vendorAccountIds,
    );

    const webSocketPush = this.addWebSocketPush(
      props.edge.wsCertificate ? { domainName: props.mailboxDomains.ws, certificate: props.edge.wsCertificate } : undefined,
      props.data,
      props.artifactResolver,
      jmapApi,
    );

    const adminApi = this.addAdminApi(
      this.adminApiAddons,
      props.data,
      props.auth,
      props.email,
      props.artifactResolver,
      props.vendorLink,
      `noreply@${props.mailboxDomains.domainName}`,
    );

    const userApi = this.addUserApi(
      props.data.configTable,
      props.data.itemTable,
      props.data.auditEventsQueue,
      props.auth.authKeyStoreTable,
      props.artifactResolver,
    );

    const mcpApi = props.enableMcp
      ? this.addMcpApi(jmapApi, props.edge.regionalCertificate, props.mailboxDomains.mcp, props.authProvider.scopeMap, props.artifactResolver)
      : undefined;

    gateway.mount(adminApi);
    gateway.mount(userApi);

    jmapApi.enableWebSocketPublishing(webSocketPush.webSocketUrl, webSocketPush.broadcaster);
    adminApi.enableWebSocketPublishing(webSocketPush.broadcaster);

    gateway.domainLogicalIdPin?.overrideLogicalId('Mailboxadminapidomain8793AE5D');
    jmapApi.domainLogicalIdPin?.overrideLogicalId('Mailboxjmapapidomain47B62A36');
    webSocketPush.domainLogicalIdPin?.overrideLogicalId('MailboxwebsocketpushdomainCACDAF3B');

    return {
      broadcaster:           webSocketPush.broadcaster,
      apiDomainTarget:       gateway.domainTarget,
      jmapApiDomainTarget:   jmapApi.domainTarget,
      webSocketDomainTarget: webSocketPush.domainTarget,
      mcpApiDomainTarget:    mcpApi?.domainTarget,
    };
  }

  private createAdminApiAddons(authProvider: IMailboxAuthProvider, providers: IAdminApiAddonProvider[], context: AdminApiAddonContext): IAdminApiAddon[] {
    const addons = [...authProvider.createAdminApiAddons(this, context)];

    for (const provider of providers) {
      addons.push(...provider.createAdminApiAddons(this, context));
    }

    return addons;
  }

  private createJmapApiAddons(authProvider: IMailboxAuthProvider, jmapApiBaseUrl: string, identityProvisioner: IIdentityProvisioner): IJmapApiAddon[] {
    if (!authProvider.createJmapApiAddons) {
      return [];
    }

    return authProvider.createJmapApiAddons(this, {
      apiBaseUrl: jmapApiBaseUrl,
      identityProvisioner,
    });
  }

  /** The shared HTTP API both the admin and the user areas mount on. Its CORS allows the origins of both UIs. */
  private addApiGateway(
    adminUiOrigins: string[],
    webmailUiOrigins: string[],
    extraAllowedOrigins: string[] | undefined,
    domainName: string,
    certificate: acm.ICertificate | undefined,
  ): ApiGateway {
    const allowedOrigins = [...adminUiOrigins, ...webmailUiOrigins, ...(extraAllowedOrigins ?? [])];

    return new ApiGateway(this, 'admin-api', {
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : undefined,

      customDomain: certificate ? { domainName, certificate } : undefined,
    });
  }

  private addJmapApi(
    cdnHost: string,
    allowedOrigins: string[],
    customDomain: ApiCustomDomainProps | undefined,
    data: IApisDataInputs,
    auth: IApisAuthInputs,
    email: IApisEmailInputs,
    artifactResolver: IArtifactResolver,
    authProvider: IMailboxAuthProvider,
    vendorAccountIds: string[],
  ): JmapApi {
    return new JmapApi(this, 'jmap-api', {
      configTable:       data.configTable,
      itemTable:         data.itemTable,
      changelogTable:    data.changelogTable,
      authKeyStoreTable: auth.authKeyStoreTable,
      cdnHost,
      allowedOrigins:       allowedOrigins.length > 0 ? allowedOrigins : undefined,
      blobStore:            data.blobStore,
      emailSubmissionQueue: email.submissionQueue,
      auditEventsQueue:     data.auditEventsQueue,
      artifactResolver,
      authProvider,
      identityProvisioner:  auth.identityProvisioner,

      customDomain,

      jmapApiAddons:  this.jmapApiAddons,
      oauthIssuerUrl: authProvider.jmapOAuthIssuerUrl?.(),
      vendorAccountIds,
    });
  }

  private addWebSocketPush(
    customDomain: ApiCustomDomainProps | undefined,
    data: IApisDataInputs,
    artifactResolver: IArtifactResolver,
    jmapApi: JmapApi,
  ): WebSocketPush {
    // Created after the JMAP API because it reuses that API's authorizer Lambda.
    const webSocketPush = new WebSocketPush(this, 'websocket-push', {
      configTable:      data.configTable,
      itemTable:        data.itemTable,
      changelogTable:   data.changelogTable,
      authorizerLambda: jmapApi.authorizerLambda,
      artifactResolver,

      customDomain,
    });
    // The websocket push carries the messaging component tag instead of the section's api tag.
    applyServerlessInboxComponentTag(webSocketPush, 'messaging');

    return webSocketPush;
  }

  private addAdminApi(
    adminApiAddons: IAdminApiAddon[],
    data: IApisDataInputs,
    auth: IApisAuthInputs,
    email: IApisEmailInputs,
    artifactResolver: IArtifactResolver,
    vendorLink: VendorLink,
    systemSenderAddress: string,
  ): AdminApi {
    return new AdminApi(this, 'admin', {
      configTable:          data.configTable,
      itemTable:            data.itemTable,
      auditLogTable:        data.auditLogTable,
      changelogTable:       data.changelogTable,
      mailFeedbackTable:    data.mailFeedbackTable,
      authKeyStoreTable:    auth.authKeyStoreTable,
      blobStore:            data.blobStore,
      emailSubmissionQueue: email.submissionQueue,
      auditEventsQueue:     data.auditEventsQueue,
      artifactResolver,
      identityProvisioner:  auth.identityProvisioner,
      vendorLink,

      addons: adminApiAddons,

      sesRuleSetName:   email.sesRuleSetName,
      sesConfigSetName: email.sesConfigSetName,
      systemSenderAddress,
    });
  }

  private addUserApi(
    configTable: IDataTable,
    itemTable: IDataTable,
    auditEventsQueue: IAuditEventsQueue,
    authKeyStoreTable: IAuthKeyStoreTable,
    artifactResolver: IArtifactResolver,
  ): UserApi {
    return new UserApi(this, 'user-api', {
      configTable,
      itemTable,
      auditEventsQueue,
      authKeyStoreTable,
      artifactResolver,
    });
  }

  private addMcpApi(
    jmapApi: JmapApi,
    regionalCertificate: acm.ICertificate | undefined,
    host: string,
    scopeMap: ScopeMap,
    artifactResolver: IArtifactResolver,
  ): McpApi {
    if (!regionalCertificate) {
      throw new Error('enableMcp needs the regional certificate: set hostedZone and leave overrides.certificates without both api and jmap');
    }

    return new McpApi(this, 'mcp-api', {
      jmapApiUrl:       jmapApi.url,
      authorizerLambda: jmapApi.authorizerLambda,
      certificate:      regionalCertificate,
      host,
      scopeMap,
      artifactResolver,
    });
  }
}
