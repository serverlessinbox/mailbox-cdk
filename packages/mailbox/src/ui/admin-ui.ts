import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { AUTH_POLICY_ADMIN_API, AuthClientConfig, MailboxAuthProvider, OAUTH_CLIENT_ADMIN_UI } from "../auth/types";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { MailboxUi } from './mailbox-ui';

export interface AdminUiProps {
  /**
   * Domain name for the CloudFront distribution (e.g., admin.example.com)
   */
  domainName: string;

  /**
   * Optional ACM certificate for `domainName`.
   * When provided, the CloudFront distribution will be configured with an alternate domain name.
   */
  certificate?: acm.ICertificate;

  /** Shared config table used by token exchange API. */
  configTable: ITable;

  /** Auth provider used to provision the OAuth client for this UI. */
  authProvider: MailboxAuthProvider;

  /**
   * Content Security Policy header value
   * Generated at build time with script/style hashes
   * Example: "default-src 'none'; script-src 'self' sha256-abc123...; ..."
   * Optional - if not provided, a basic CSP will be used
   */
  cspPolicy?: string;

  /** Base URL for the Admin UI's backend API. Written into `/config/config.json`. */
  apiUrl?: string;

  /** Additional runtime config written into `/config/config.json` (e.g. feature flags / IdP user management config). */
  uiConfig?: Record<string, unknown>;
}

/**
 * Admin UI Module
 *
 * Creates infrastructure for hosting the admin dashboard:
 * - S3 bucket for storing static UI files
 * - CloudFront distribution for global CDN delivery
 * - Origin Access Identity for secure S3 access
 * - Routes /auth/* requests to OAuth API
 * - CSP security headers
 *
 * Example:
 * ```typescript
 * const oauthHandler = new OAuthHandler(this, 'oauth-handler', {...});
 * 
 * const adminUi = new AdminUi(this, 'admin-ui', {
 *   domainName: 'admin.example.com',
 *   oauthApiUrl: oauthHandler.apiUrl + '/admin/auth',
 * });
 *
 * console.log(`Admin UI available at: ${adminUi.distributionDomainName}`);
 * ```
 */
export class AdminUi extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly distributionDomainName: string;
  readonly oauthClient: AuthClientConfig;
  readonly oauthRedirectUri: string;

  constructor(scope: Construct, id: string, props: AdminUiProps) {
    super(scope, id);

    const mergedUiConfig = {
      ...(props.uiConfig ?? {}),
      ...(props.apiUrl ? { apiUrl: props.apiUrl } : {}),
    };

    const ui = new MailboxUi(this, 'ui', {
      label: 'Admin UI',
      domainName: props.domainName,
      certificate: props.certificate,
      configTable: props.configTable,
      authPolicyName: AUTH_POLICY_ADMIN_API,
      oauthClientName: OAUTH_CLIENT_ADMIN_UI,
      uiBundle: {
        packageName: 'mailbox-admin-ui',
        objectPath: 'admin-ui.zip',
      },
      uiConfig: Object.keys(mergedUiConfig).length > 0 ? mergedUiConfig : undefined,
    });

    const uiHost = ui.distributionDomainName;
    this.oauthClient = props.authProvider.provisionAdminUiClient({
      callbackUrls: [`https://${uiHost}/auth/callback`],
      logoutUrls: [`https://${uiHost}/`],
    });

    this.oauthRedirectUri = '/dashboard';

    this.bucket = ui.bucket;
    this.distribution = ui.distribution;
    this.distributionDomainName = ui.distributionDomainName;
  }
}
