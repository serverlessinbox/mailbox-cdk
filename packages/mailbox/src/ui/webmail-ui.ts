import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { AUTH_POLICY_JMAP_API, AuthClientConfig, AuthConfig, OAUTH_CLIENT_JMAP_UI } from "../auth/types";
import { Permission } from '../auth/jmap-scopes';
import { MailboxUi, UiBundleSource } from './mailbox-ui';

export interface WebmailUiProps {
  /**
   * Domain name for the CloudFront distribution (e.g., webmail.example.com)
   */
  domainName: string;

  /**
   * Optional ACM certificate for `domainName`.
   * When provided, the CloudFront distribution will be configured with an alternate domain name.
   */
  certificate?: acm.ICertificate;

  /**
   * Shared config table used by token exchange API.
   */
  configTable: ITable;

  /** Auth provider used to generate the OAuth client for this UI. */
  authConfig: AuthConfig;

  /** Optional UI bundle (zip) published as an artifact. Deployed to `s3://<ui-bucket>/content/` via custom resource. */
  uiBundle?: UiBundleSource;

  /** Base URL for the Webmail UI's backend API. Written into `/config/config.json`. */
  apiUrl?: string;
}

export class WebmailUi extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly distributionDomainName: string;
  readonly oauthClient: AuthClientConfig;
  readonly oauthRedirectUri: string;

  constructor(scope: Construct, id: string, props: WebmailUiProps) {
    super(scope, id);

    const ui = new MailboxUi(this, 'ui', {
      label: 'Webmail UI',
      domainName: props.domainName,
      certificate: props.certificate,
      configTable: props.configTable,
      authPolicyName: AUTH_POLICY_JMAP_API,
      oauthClientName: OAUTH_CLIENT_JMAP_UI,
      uiBundle: props.uiBundle,
      uiConfig: props.apiUrl ? { apiUrl: props.apiUrl } : undefined,
    });

    const uiHost = ui.distributionDomainName;
    const allPermissions = Object.values(Permission);
    this.oauthClient = props.authConfig.generateClient({
      flow: 'authorization_code',
      name: OAUTH_CLIENT_JMAP_UI,
      permissions: allPermissions,
      callbackUrls: [`https://${uiHost}/auth/callback`],
      logoutUrls: [`https://${uiHost}/`],
    });

    this.oauthRedirectUri = '/';

    this.bucket = ui.bucket;
    this.distribution = ui.distribution;
    this.distributionDomainName = ui.distributionDomainName;
  }
}
