import type { IArtifactResolver }                        from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }              from '@serverlessinbox/mailbox-cdk-shared';
import type * as route53                                 from 'aws-cdk-lib/aws-route53';
import type { IReceiptRuleSet }                          from 'aws-cdk-lib/aws-ses';
import { Construct, DependencyGroup }                    from 'constructs';
import type { IDependable }                              from 'constructs';

import type { IDataBlobStore }                           from '../../resources/buckets/data-blob-store';
import { IdentityProvisionerLambda }                     from '../../resources/lambdas/identity-provisioner-lambda';
import type { IIdentityProvisioner }                     from '../../resources/lambdas/identity-provisioner-lambda';
import type { IAuditEventsQueue }                        from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                       from '../../resources/queues/email-sending-queue';
import type { IAuthKeyStoreTable }                       from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                               from '../../resources/tables/data-tables';
import type { SesReceivingMode }                         from '../email/ses-receiving-mode';
import type { IOAuthUi }                                 from '../ui/ui-section';

import { AuthKeyStore }                                  from './auth-key-store';
import { Bootstrap }                                     from './bootstrap';
import type { IMailboxAuthProvider, OAuthClientsConfig } from './types';

/** Props of {@link AuthSection}: what the auth key store and the identity provisioner are built from. */
export interface AuthSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly authProvider: IMailboxAuthProvider;
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly sesConfigSetName: string;
  readonly domainName: string;
  readonly vendorAccountIds: string[];
  /** URL of the Admin UI; absent when no Admin UI is deployed. */
  readonly adminUiUrl?: string;
}

/** Props of {@link AuthSection.addBootstrap}: the values that exist only after the UIs. */
export interface AuthBootstrapProps {
  readonly sesRuleSet: IReceiptRuleSet;
  readonly sesReceivingMode?: SesReceivingMode;
  /** Present when the mailbox has a hosted zone. */
  readonly hostedZone?: route53.IHostedZone;
  readonly stackIdentityTagKey: string;
  /** The Admin UI, when enabled. */
  readonly adminUi?: IOAuthUi;
  /** The Webmail UI, when enabled. */
  readonly webmailUi?: IOAuthUi;
}

/** The auth key store, the identity provisioner and, once the UIs exist, the bootstrap. */
export class AuthSection extends Construct {
  public readonly authKeyStoreTable: IAuthKeyStoreTable;
  public readonly identityProvisioner: IIdentityProvisioner;
  /** Satisfied once the bootstrap has written the OAuth client rows; the Webmail UI waits on it. */
  public readonly oauthClientsProvisioned: IDependable;

  private readonly props: AuthSectionProps;
  private readonly oauthClientsProvisionedGroup: DependencyGroup;

  constructor(scope: Construct, id: string, props: AuthSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'auth');

    this.props = props;

    // The webmail token exchange waits on this group; the bootstrap resource joins it once built.
    this.oauthClientsProvisionedGroup = new DependencyGroup();
    this.oauthClientsProvisioned      = this.oauthClientsProvisionedGroup;

    const authKeyStore = new AuthKeyStore(this, 'auth-key-store', {
      issuers: [props.authProvider.issuer],
      artifactResolver: props.artifactResolver,
    });

    this.authKeyStoreTable = authKeyStore.authKeyStoreTable;

    this.identityProvisioner = new IdentityProvisionerLambda(this, 'identity-provisioner', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
      adminUIURL: props.adminUiUrl,
      blobStore: props.blobStore,
      emailSubmissionQueue: props.emailSubmissionQueue,
      sesConfigSetName: props.sesConfigSetName,
      systemSenderAddress: `noreply@${props.domainName}`,
      vendorAccountIds: props.vendorAccountIds,
    });
  }

  /** Adds the bootstrap; it registers the UIs' OAuth clients, so it follows the UIs. */
  public addBootstrap(props: AuthBootstrapProps): void {
    const authProvider = this.props.authProvider;

    const adminRequiredGroups = authProvider.policies.adminApi.requireAnyOfGroups
      ?? props.adminUi?.oauthClient.groups
      ?? undefined;

    const bootstrap = new Bootstrap(this, 'bootstrap', {
      domain: this.props.domainName,
      oidcIssuer: authProvider.issuer,
      configTable: this.props.configTable,
      authKeyStoreTable: this.authKeyStoreTable,
      artifactResolver: this.props.artifactResolver,
      sesRuleSet: props.sesRuleSet,
      sesReceivingMode: props.sesReceivingMode,
      sesSendEnabled: true,
      hostedZone: props.hostedZone,
      vendorAccountIds: this.props.vendorAccountIds,
      stackIdentityTagKey: props.stackIdentityTagKey,

      oidcProvider: {
        tokenEndpoint: authProvider.tokenEndpoint,
        authorizationEndpoint: authProvider.authorizationEndpoint,
        authMethod: authProvider.authMethod,
        usePkce: authProvider.usePkce,
      },
      authPolicies: {
        adminApi: {
          audiences: authProvider.policies.adminApi.audiences,
          requireAnyOfGroups: adminRequiredGroups,
          requireAllScopes: authProvider.policies.adminApi.requireAllScopes,
        },
        jmapApi: {
          audiences: authProvider.policies.jmapApi.audiences,
          requireAllScopes: authProvider.policies.jmapApi.requireAllScopes,
        },
      },
      oauthClients: this.bootstrapOAuthClients(props),
    });

    this.oauthClientsProvisionedGroup.add(bootstrap.oauthClientsProvisioned);
  }

  private bootstrapOAuthClients(props: AuthBootstrapProps): OAuthClientsConfig | undefined {
    const { adminUi, webmailUi } = props;

    return (adminUi || webmailUi)
      ? {
        adminUi: adminUi
          ? {
            flow: 'authorization_code',
            clientId: adminUi.oauthClient.clientId,
            clientSecret: adminUi.oauthClient.clientSecret,
            scopes: ['openid', 'email', 'profile', ...adminUi.oauthClient.requestScopeList],
            redirectUri: adminUi.oauthRedirectUri,
          }
          : undefined,
        webmailUi: webmailUi
          ? {
            flow: 'authorization_code',
            clientId: webmailUi.oauthClient.clientId,
            clientSecret: webmailUi.oauthClient.clientSecret,
            scopes: ['openid', 'email', 'profile', ...webmailUi.oauthClient.requestScopeList],
            redirectUri: webmailUi.oauthRedirectUri,
          }
          : undefined,
      }
      : undefined;
  }
}
