import { Construct } from 'constructs';
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { AUTH_POLICY_JMAP_API, AuthClientConfig, IMailboxAuthProvider, OAUTH_CLIENT_JMAP_UI } from "../auth/types";
import { Permission } from '../auth/jmap-scopes';
import { MailboxUi, UiBundleSource } from './mailbox-ui';

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
  readonly configTable: ITable;

  /** Auth provider used to provision the OAuth client for this UI. */
  readonly authProvider: IMailboxAuthProvider;

  /** Optional audit events queue for publishing audit logs from token exchange. */
  readonly auditEventsQueue?: IQueue;

  /** Optional UI bundle (zip) published as an artifact. Deployed to `s3://<ui-bucket>/content/` via custom resource. */
  readonly uiBundle?: UiBundleSource;

  /** Base URL for the Webmail UI's backend API. Written into `/config/config.json`. */
  readonly apiUrl?: string;
}

export class WebmailUi extends MailboxUi {
  readonly oauthClient: AuthClientConfig;
  readonly oauthRedirectUri: string;

  constructor(scope: Construct, id: string, props: WebmailUiProps) {
    super(scope, id, {
      label: 'Webmail UI',
      domainName: props.domainName,
      certificate: props.certificate,
      configTable: props.configTable,
      auditEventsQueue: props.auditEventsQueue,
      authPolicyName: AUTH_POLICY_JMAP_API,
      oauthClientName: OAUTH_CLIENT_JMAP_UI,
      uiBundle: props.uiBundle,
      uiConfig: props.apiUrl ? { apiUrl: props.apiUrl } : undefined,
    });

    const uiHost = this.distributionDomainName;
    const allPermissions = Object.values(Permission);
    this.oauthClient = props.authProvider.provisionJmapUiClient({
      name: 'integrated',
      permissions: allPermissions,
      callbackUrls: [`https://${uiHost}/auth/callback`],
      logoutUrls: [`https://${uiHost}/`],
    });

    this.oauthRedirectUri = '/';
  }
}
