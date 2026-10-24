import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }                      from '@serverlessinbox/mailbox-cdk-shared';
import type { VendorLink }                           from '@serverlessinbox/mailbox-cdk-shared';
import type { IFunction }                            from 'aws-cdk-lib/aws-lambda';
import { IReceiptRuleSet }                           from 'aws-cdk-lib/aws-ses';
import { CustomResource, Duration }                  from 'aws-cdk-lib';
import { Construct, IDependable }                    from 'constructs';

import type { SesReceivingMode }                     from '../../contracts/ses-receiving-mode';
import { BootstrapLambda }                           from '../../resources/lambdas/bootstrap-lambda';
import type { IAuthKeyStoreTable }                   from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                           from '../../resources/tables/data-tables';
import type { IDnsZone }                             from '../edge/dns-zone';

import type {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from './auth-bootstrap-config';

/** Inputs of the bootstrap custom resource and of the Lambda behind it. */
export interface BootstrapProps {
  readonly configTable:       IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;

  readonly domain:     string;
  readonly oidcIssuer: string;

  readonly oidcProvider?: OidcProviderConfig;
  readonly authPolicies?: AuthPoliciesConfig;
  readonly oauthClients?: OAuthClientsConfig;

  readonly artifactResolver:  IArtifactResolver;
  readonly sesRuleSet:        IReceiptRuleSet;
  readonly sesReceivingMode?: SesReceivingMode;
  /** When true, the bootstrap Lambda will mark the default domain as SES send-capable. */
  readonly sesSendEnabled?: boolean;
  /** The hosted zone the bootstrap role may manage records in; its id is sent to the bootstrap Lambda. */
  readonly dnsZone?: IDnsZone;
  /** The vendor accounts that scope the execute-api:Invoke permission and the tag key that identifies this stack's resources, resolved by the caller. */
  readonly vendorLink: VendorLink;
}

/** One OAuth client as the bootstrap custom resource sends it to the bootstrap Lambda. */
interface BootstrapOAuthClientProperties {
  readonly requestedAudience: string;
  readonly clientId:          string;
  readonly clientSecret:      string | undefined;
  readonly scopes:            string[];
  readonly redirectUri:       string;
}

const BOOTSTRAP_LAMBDA_TIMEOUT = Duration.seconds(30);
const SERVICE_TIMEOUT_MARGIN   = Duration.seconds(30);

/**
 * Runs the one-time deploy-time setup of a mailbox through a custom resource: the Lambda behind it
 * receives the domain, the OIDC provider, the auth policies and the OAuth clients as properties.
 */
export class Bootstrap extends Construct {
  /** The Lambda function backing the bootstrap custom resource. */
  readonly handler: IFunction;

  /** Satisfied once the bootstrap custom resource has written the OAuth client rows to the config table. */
  readonly oauthClientsProvisioned: IDependable;

  constructor(scope: Construct, id: string, props: BootstrapProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Runs one-time deploy-time setup: SES identity/receipt config, OIDC/OAuth client registration, and config/DNS seeding.');

    this.handler = new BootstrapLambda(this, 'handler', {
      timeout:           BOOTSTRAP_LAMBDA_TIMEOUT,
      configTable:       props.configTable,
      authKeyStoreTable: props.authKeyStoreTable,
      artifactResolver:  props.artifactResolver,
      domain:            props.domain,
      sesRuleSet:        props.sesRuleSet,
      sesReceivingMode:  props.sesReceivingMode,
      sesSendEnabled:    props.sesSendEnabled,
      dnsZone:           props.dnsZone,
      vendorLink:        props.vendorLink,
    });

    const bootstrapResource      = new CustomResource(this, 'resource', {
      resourceType:   'Custom::Bootstrap',
      serviceToken:   this.handler.functionArn,
      serviceTimeout: BOOTSTRAP_LAMBDA_TIMEOUT.plus(SERVICE_TIMEOUT_MARGIN),
      properties:     {
        ensureServiceQuotasPrereqs: true,
        tenantName:                 'default-tenant',
        defaultLocalPart:           '{username}',
        domain:                     props.domain,
        oidcIssuer:                 props.oidcIssuer,

        oidcProvider: props.oidcProvider,
        authPolicies: props.authPolicies,
        oauthClients: props.oauthClients
          ? {
            adminUi:   props.oauthClients.adminUi ? this.toRequestOAuthClient(props.oauthClients.adminUi) : undefined,
            webmailUi: props.oauthClients.webmailUi ? this.toRequestOAuthClient(props.oauthClients.webmailUi) : undefined,
          }
          : undefined,
        hostedZoneId: props.dnsZone?.hostedZoneId,
      },
    });
    this.oauthClientsProvisioned = bootstrapResource;
  }

  private toRequestOAuthClient(client: OAuthAuthorizationCodeClientConfig): BootstrapOAuthClientProperties {
    return {
      requestedAudience: client.requestedAudience ?? client.clientId,
      clientId:          client.clientId,
      clientSecret:      client.clientSecret?.unsafeUnwrap(),
      scopes:            client.scopes,
      redirectUri:       client.redirectUri,
    };
  }
}
