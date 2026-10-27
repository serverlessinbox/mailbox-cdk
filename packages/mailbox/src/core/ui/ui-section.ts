import type { IArtifactResolver }            from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }  from '@serverlessinbox/mailbox-cdk-shared';
import type * as acm                         from 'aws-cdk-lib/aws-certificatemanager';
import { Construct }                         from 'constructs';
import type { IDependable }                  from 'constructs';

import type { IUiContentUpdater }            from '../../contracts/ui-content-updater';
import type { MailboxOAuthClients }          from '../../mailbox-outputs';
import type { MailboxCertificateOverrides }  from '../../mailbox-props';
import type { IAuditEventsQueue }            from '../../resources/queues/audit-events-queue';
import type { IDataTable }                   from '../../resources/tables/data-tables';
import type { IAdminApiAddon }               from '../apis/addons';
import type { AuthClientConfig }             from '../auth/auth-provider';
import type { IMailboxAuthProvider }         from '../auth/auth-provider';
import type { IMailboxDomainNames }          from '../domains/mailbox-domains';

import { AdminUi }                           from './admin-ui';
import type { MailboxUi, MailboxUiConfig }   from './mailbox-ui';
import { WebmailUi }                         from './webmail-ui';

/** What {@link UiSection} uses of the data section. */
export interface IUiDataInputs {
  readonly configTable:      IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
}

/** What {@link UiSection} uses of the auth section. */
export interface IUiAuthInputs {
  /** The Webmail UI's token exchange waits on this before it switches to the Webmail OAuth client row. */
  readonly oauthClientsProvisioned: IDependable;
}

/** What {@link UiSection} uses of the apis section. */
export interface IUiApisInputs {
  /** The admin-API addons whose UI configuration is merged into the Admin UI's runtime config. */
  readonly adminApiAddons: IAdminApiAddon[];
}

/** What {@link UiSection} uses of the edge section. */
export interface IUiEdgeInputs {
  /** The certificate the UIs are served with unless the operator gave their own; present when the mailbox has a hosted zone. */
  readonly uiCertificate?: acm.ICertificate;
}

/** Props of {@link UiSection}. */
export interface UiSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly authProvider:     IMailboxAuthProvider;
  readonly enableAdminUi:    boolean;
  readonly enableWebmailUi:  boolean;
  /** The endpoint names the UIs are served on and call. */
  readonly mailboxDomains: IMailboxDomainNames;
  /** The operator's own certificates; the adminUi and webmailUi ones are read here, and the edge section's UI certificate serves a UI without one. */
  readonly certificateOverrides?: MailboxCertificateOverrides;
  readonly data:                  IUiDataInputs;
  readonly auth:                  IUiAuthInputs;
  readonly apis:                  IUiApisInputs;
  readonly edge:                  IUiEdgeInputs;
}

/** What the bootstrap needs of a UI: the OAuth client it registered and where the client lands after login. */
export interface IOAuthUi {
  readonly oauthClient:      AuthClientConfig;
  readonly oauthRedirectUri: string;
}

/** The Admin UI and the Webmail UI, each built only when enabled. */
export class UiSection extends Construct {
  /** The Admin UI, when enabled. */
  public readonly adminUi?: IOAuthUi;
  /** The Webmail UI, when enabled. */
  public readonly webmailUi?: IOAuthUi;
  /** The OAuth clients of the enabled UIs. */
  public readonly oauthClients: MailboxOAuthClients;
  /** Origins the Admin UI is served from; empty when it is disabled. */
  public readonly adminUiOrigins: string[];
  /** Origins the Webmail UI is served from; empty when it is disabled. */
  public readonly webmailUiOrigins: string[];
  /** CNAME target of the Admin UI's distribution, when enabled. */
  public readonly adminUiCnameTarget?: string;
  /** CNAME target of the Webmail UI's distribution, when enabled. */
  public readonly webmailUiCnameTarget?: string;

  constructor(scope: Construct, id: string, props: UiSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ui');

    const adminUi   = props.enableAdminUi ? this.addAdminUi(props) : undefined;
    const webmailUi = props.enableWebmailUi ? this.addWebmailUi(props) : undefined;

    this.adminUi   = adminUi;
    this.webmailUi = webmailUi;

    this.adminUiOrigins       = adminUi ? [`https://${adminUi.distributionDomainName}`] : [];
    this.adminUiCnameTarget   = adminUi?.distribution.distributionDomainName;
    this.webmailUiOrigins     = webmailUi ? [`https://${webmailUi.distributionDomainName}`] : [];
    this.webmailUiCnameTarget = webmailUi?.distribution.distributionDomainName;

    this.oauthClients = {
      ...(adminUi ? { adminUi: adminUi.oauthClient } : {}),
      ...(webmailUi ? { webmailUi: webmailUi.oauthClient } : {}),
    };
  }

  private addAdminUi(props: UiSectionProps): AdminUi {
    const adminUi = new AdminUi(this, 'admin-ui', {
      domainName:       props.mailboxDomains.admin,
      certificate:      props.certificateOverrides?.adminUi ?? props.edge.uiCertificate,
      configTable:      props.data.configTable,
      auditEventsQueue: props.data.auditEventsQueue,
      authProvider:     props.authProvider,
      apiUrl:           `https://${props.mailboxDomains.api}/admin`,
      webmailUrl:       props.enableWebmailUi && this.webmailUiCertificate(props)
        ? `https://${props.mailboxDomains.webmail}`
        : undefined,
      uiConfig:         this.mergeAdminUiConfig(props),
      artifactResolver: props.artifactResolver,
    });

    this.enableUiContentUpdateIfSupported(adminUi, props.artifactResolver);

    return adminUi;
  }

  private addWebmailUi(props: UiSectionProps): WebmailUi {
    const webmailUi = new WebmailUi(this, 'webmail-ui', {
      domainName:       props.mailboxDomains.webmail,
      certificate:      this.webmailUiCertificate(props),
      configTable:      props.data.configTable,
      auditEventsQueue: props.data.auditEventsQueue,
      authProvider:     props.authProvider,
      jmapUrl:          `https://${props.mailboxDomains.jmap}`,
      userApiUrl:       `https://${props.mailboxDomains.api}/user`,
      artifactResolver: props.artifactResolver,
      dependsOn:        [props.auth.oauthClientsProvisioned],
    });

    this.enableUiContentUpdateIfSupported(webmailUi, props.artifactResolver);

    return webmailUi;
  }

  private webmailUiCertificate(props: UiSectionProps): acm.ICertificate | undefined {
    return props.certificateOverrides?.webmailUi ?? props.edge.uiCertificate;
  }

  /** Builds the admin UI config eagerly by merging the provider's authorization and all addon configs. */
  private mergeAdminUiConfig(props: UiSectionProps): MailboxUiConfig | undefined {
    const providerAuthz = props.authProvider.authorizationConfig?.();

    const mergedAdminUiConfig: MailboxUiConfig = {
      ...(providerAuthz
        ? {
          authorization: {
            roles: {
              adminGroups: providerAuthz.adminGroups,
              userGroups:  providerAuthz.userGroups,
            },
          },
        }
        : {}),
    };

    for (const addon of props.apis.adminApiAddons) {
      if (addon.uiConfig) {
        Object.assign(mergedAdminUiConfig, addon.uiConfig);
      }
    }

    return Object.keys(mergedAdminUiConfig).length > 0 ? mergedAdminUiConfig : undefined;
  }

  /**
   * Lets `resolver` update `ui`'s content when the resolver offers that. `resolver` is typed
   * `IArtifactResolver`, which has no content update, so a resolver without one needs no grant and
   * is skipped.
   */
  private enableUiContentUpdateIfSupported(ui: MailboxUi, resolver: IArtifactResolver): void {
    if (this.isUiContentUpdater(resolver)) {
      resolver.enableUiContentUpdate(ui);
    }
  }

  private isUiContentUpdater(resolver: IArtifactResolver): resolver is IArtifactResolver & IUiContentUpdater {
    return 'enableUiContentUpdate' in resolver && typeof resolver.enableUiContentUpdate === 'function';
  }
}
