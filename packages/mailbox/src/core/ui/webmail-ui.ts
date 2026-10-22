import type { IArtifactResolver }                                                                from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }                                                                  from '@serverlessinbox/mailbox-cdk-shared';
import * as acm                                                                                  from 'aws-cdk-lib/aws-certificatemanager';
import { Construct, IDependable }                                                                from 'constructs';

import type { IAuditEventsQueue }                                                                from '../../resources/queues/audit-events-queue';
import type { IDataTable }                                                                       from '../../resources/tables/data-tables';
import { Permission }                                                                            from '../auth/jmap-scopes';
import { AUTH_POLICY_JMAP_API, AuthClientConfig, IMailboxAuthProvider, OAUTH_CLIENT_WEBMAIL_UI } from '../auth/types';

import { MailboxUi, UiBundleSource }                                                             from './mailbox-ui';

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

  /** Optional UI bundle (zip) published as an artifact. Deployed to `s3://<ui-bucket>/content/` via custom resource. */
  readonly uiBundle?: UiBundleSource;

  /** Base URL for the Webmail UI's backend API. Written into `/config/config.json`. */
  readonly apiUrl?: string;

  /** Artifact resolver for all UI resources (bundle + ui-deployer + token-exchange). */
  readonly artifactResolver: IArtifactResolver;

  /** Resources that must be deployed before the token-exchange function switches to the `WEBMAIL_UI` client row. */
  readonly dependsOn?: IDependable[];
}

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
      authPolicyName:           AUTH_POLICY_JMAP_API,
      oauthClientName:          OAUTH_CLIENT_WEBMAIL_UI,
      tokenExchangeDependsOn:   props.dependsOn,
      uiBundle:                 props.uiBundle,
      uiConfig:                 props.apiUrl ? { apiUrl: props.apiUrl } : undefined,
      artifactResolver:         props.artifactResolver,
    });
    ComponentDescription.describe(this, 'Webmail client — S3-hosted static site behind CloudFront with an OAuth token-exchange backend (BFF).');

    const uiHost         = this.distributionDomainName;
    const allPermissions = Object.values(Permission);
    this.oauthClient     = props.authProvider.provisionJmapApiClient({
      name:         'webmail-ui',
      permissions:  allPermissions,
      callbackUrls: [`https://${uiHost}/auth/callback`],
      logoutUrls:   [`https://${uiHost}/`],
    });

    this.oauthRedirectUri = '/';
  }
}
