import { CustomResource, Duration } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IReceiptRuleSet } from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct, IDependable } from 'constructs';
import type { IDataTable } from '../../data/data-tables';
import { BootstrapLambda } from '../../lambdas';
import { BOOTSTRAP_LAMBDA_TIMEOUT } from '../../lambdas/bootstrap';
import type { SesReceivingMode } from '../../core/email/ses-receiving-mode';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IAuthKeyStoreTable } from '../auth-key-store/auth-key-store-table';
import type {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from '../../auth/types';

const SERVICE_TIMEOUT_MARGIN = Duration.seconds(30);

/** Inputs of the bootstrap custom resource and of the Lambda behind it. */
export interface BootstrapProps {
  readonly configTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;

  readonly tenantName?: string;
  readonly defaultLocalPart?: string;
  readonly domain: string;
  readonly oidcIssuer: string;
  readonly oidcProviderName?: string;

  readonly oidcProvider?: OidcProviderConfig;
  readonly authPolicies?: AuthPoliciesConfig;
  readonly oauthClients?: OAuthClientsConfig;

  readonly artifactResolver: IArtifactResolver;
  readonly sesRuleSet: IReceiptRuleSet;
  readonly sesReceivingMode?: SesReceivingMode;
  /** When true, the bootstrap Lambda will mark the default domain as SES send-capable. */
  readonly sesSendEnabled?: boolean;
  readonly hostedZone?: route53.IHostedZone;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key used to identify resources belonging to this stack, sourced from the tag-key registry. */
  readonly stackIdentityTagKey: string;
}

/**
 * CDK Construct for bootstrapping a new tenant.
 */
export class Bootstrap extends Construct {
  /** The Lambda function backing the bootstrap custom resource. */
  readonly handler: IFunction;

  /** Satisfied once the bootstrap custom resource has written the OAuth client rows to the config table. */
  readonly oauthClientsProvisioned: IDependable;

  constructor(scope: Construct, id: string, props: BootstrapProps) {
    super(scope, id);

    this.handler = new BootstrapLambda(this, 'handler', {
      configTable: props.configTable,
      authKeyStoreTable: props.authKeyStoreTable,
      artifactResolver: props.artifactResolver,
      domain: props.domain,
      sesRuleSet: props.sesRuleSet,
      sesReceivingMode: props.sesReceivingMode,
      sesSendEnabled: props.sesSendEnabled,
      hostedZone: props.hostedZone,
      vendorAccountIds: props.vendorAccountIds,
      stackIdentityTagKey: props.stackIdentityTagKey,
    });

    const bootstrapResource = new CustomResource(this, 'resource', {
      resourceType: 'Custom::Bootstrap',
      serviceToken: this.handler.functionArn,
      serviceTimeout: BOOTSTRAP_LAMBDA_TIMEOUT.plus(SERVICE_TIMEOUT_MARGIN),
      properties: {
        ensureServiceQuotasPrereqs: true,
        tenantName: props.tenantName ?? 'default-tenant',
        defaultLocalPart: props.defaultLocalPart ?? '{username}',
        domain: props.domain,
        oidcIssuer: props.oidcIssuer,
        oidcProviderName: props.oidcProviderName,

        oidcProvider: props.oidcProvider,
        authPolicies: props.authPolicies,
        oauthClients: props.oauthClients
          ? {
            adminUi: props.oauthClients.adminUi ? this.toRequestOAuthClient(props.oauthClients.adminUi) : undefined,
            webmailUi: props.oauthClients.webmailUi ? this.toRequestOAuthClient(props.oauthClients.webmailUi) : undefined,
          }
          : undefined,
        hostedZoneId: props.hostedZone?.hostedZoneId,
      },
    });
    this.oauthClientsProvisioned = bootstrapResource;
  }

  private toRequestOAuthClient(client: OAuthAuthorizationCodeClientConfig) {
    return {
      requestedAudience: client.requestedAudience ?? client.clientId,
      clientId: client.clientId,
      clientSecret: client.clientSecret?.unsafeUnwrap(),
      scopes: client.scopes,
      redirectUri: client.redirectUri,
    };
  }
}
