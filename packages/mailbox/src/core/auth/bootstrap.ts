import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import type { VendorLink }                           from '@serverlessinbox/mailbox-cdk-shared';
import type { IFunction }                            from 'aws-cdk-lib/aws-lambda';
import * as route53                                  from 'aws-cdk-lib/aws-route53';
import { IReceiptRuleSet }                           from 'aws-cdk-lib/aws-ses';
import { CustomResource, Duration }                  from 'aws-cdk-lib';
import { Construct, IDependable }                    from 'constructs';

import { BOOTSTRAP_LAMBDA_TIMEOUT, BootstrapLambda } from '../../resources/lambdas/bootstrap-lambda';
import type { IAuthKeyStoreTable }                   from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                           from '../../resources/tables/data-tables';
import type { SesReceivingMode }                     from '../email/ses-receiving-mode';

import type {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from './types';

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
  /** The vendor accounts that scope the execute-api:Invoke permission and the tag key that identifies this stack's resources, resolved by the caller. */
  readonly vendorLink: VendorLink;
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
      vendorLink: props.vendorLink,
    });

    const bootstrapResource      = new CustomResource(this, 'resource', {
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
