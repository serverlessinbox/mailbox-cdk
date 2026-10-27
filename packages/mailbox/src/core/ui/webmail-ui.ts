import type { IArtifactResolver }                                                                from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }                                                                  from '@serverlessinbox/mailbox-cdk-shared';
import type * as acm                                                                             from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct, IDependable }                                                           from 'constructs';

import { AuthPolicyName, OAuthClientName }                                                       from '../../contracts/auth-names';
import type { IAuditEventsQueue }                                                                from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                                       from '../../resources/tables/data-tables';
import type { AuthClientConfig, IMailboxAuthProvider }                                           from '../auth/auth-provider';
import { Permission }                                                                            from '../auth/jmap-scopes';

import { MailboxUi }                                                                             from './mailbox-ui';

/** Props of {@link WebmailUi}. */
export interface WebmailUiProps {
  /**
   * Domain name for the CloudFront distribution (e.g., webmail.example.com)
   */
  readonly domainName: string;

  /**
   * Optional ACM certificate for `domainName`.
   * When provided, the CloudFront distribution will be configured with an alternate domain name.
   */
  readonly certificate?: acm.ICertificate;

  /**
   * Shared config table used by token exchange API.
   */
  readonly configTable: IDataTable;

  /** Auth provider used to provision the OAuth client for this UI. */
  readonly authProvider: IMailboxAuthProvider;

  /** Audit events queue for publishing audit logs from token exchange. */
  readonly auditEventsQueue: IAuditEventsQueue;

  /** Base URL for the Webmail UI's backend API. Written into `/config/config.json`. */
  readonly apiUrl: string;

  /** Base URL for the user API's routes. Written into `/config/config.json` as `userApiUrl`. */
  readonly userApiUrl: string;

  /** Artifact resolver for all UI resources (bundle + ui-deployer + token-exchange). */
  readonly artifactResolver: IArtifactResolver;

  /** Resources that must be deployed before the token-exchange function switches to the `WEBMAIL_UI` client row. */
  readonly dependsOn?: IDependable[];
}

/**
 * The webmail client: a {@link MailboxUi} that serves the Webmail UI bundle and registers the OAuth
 * client the Webmail UI logs in with.
 */
export class WebmailUi extends MailboxUi {
  readonly oauthClient: AuthClientConfig;
  readonly oauthRedirectUri: string;

  constructor(scope: Construct, id: string, props: WebmailUiProps) {
    super(scope, id, {
      label:                    'Webmail UI',
      tokenExchangeServiceName: 'idp-token-exchange-webmail-ui',
      tokenExchangePipeline:    'jmap',
      domainName:               props.domainName,
      certificate:              props.certificate,
      configTable:              props.configTable,
      auditEventsQueue:         props.auditEventsQueue,
      authPolicyName:           AuthPolicyName.JMAP_API,
      oauthClientName:          OAuthClientName.WEBMAIL_UI,
      tokenExchangeDependsOn:   props.dependsOn,
      uiBundle:                 {
        packageName: 'mailbox-webmail-ui',
        objectPath:  'webmail-ui.zip',
      },
      uiConfig:                 { apiUrl: props.apiUrl, userApiUrl: props.userApiUrl },
      artifactResolver:         props.artifactResolver,
    });
    ComponentDescription.describe(this, 'Webmail client — S3-hosted static site behind CloudFront with an OAuth token-exchange backend (BFF).');

    const uiHost                           = this.distributionDomainName;
    const webmailPermissions: Permission[] = [
      Permission.MAIL_READ,
      Permission.MAIL_WRITE,
      Permission.MAIL_SEND,
      Permission.ACCOUNT_READ,
      Permission.ALIAS_READ,
      Permission.USER_READ,
      Permission.CONTACTS_READ,
      Permission.CONTACTS_WRITE,
    ];
    this.oauthClient                       = props.authProvider.provisionJmapApiClient({
      name:         'webmail-ui',
      permissions:  webmailPermissions,
      callbackUrls: [`https://${uiHost}/auth/callback`],
      logoutUrls:   [`https://${uiHost}/`],
    });

    this.oauthRedirectUri = '/';
  }
}
