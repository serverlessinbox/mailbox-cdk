import { CustomResource, Duration } from 'aws-cdk-lib';
import { IReceiptRuleSet } from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { BootstrapLambda, SesReceivingMode } from '../lambdas';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from '../auth/types';

export interface BootstrapProps {
  readonly configTable: ITable;
  readonly jwkCacheTable: ITable;
  readonly authKeyStoreTable: ITable;

  readonly tenantName?: string;
  readonly defaultLocalPart?: string;
  readonly domain: string;
  readonly oidcIssuer: string;
  readonly oidcProviderName?: string;

  readonly oidcProvider?: OidcProviderConfig;
  readonly authPolicies?: AuthPoliciesConfig;
  readonly oauthClients?: OAuthClientsConfig;

  readonly artifactResolver: ICdkArtifactEngine;
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
  readonly handler: BootstrapLambda;

  constructor(scope: Construct, id: string, props: BootstrapProps) {
    super(scope, id);

    const toRequestOAuthClient = (client: OAuthAuthorizationCodeClientConfig) => ({
      requestedAudience: client.requestedAudience ?? client.clientId,
      clientId: client.clientId,
      clientSecret: client.clientSecret?.unsafeUnwrap(),
      scopes: client.scopes,
      redirectUri: client.redirectUri,
    });

    const handler = new BootstrapLambda(this, 'handler', {
      configTable: props.configTable,
      jwkCacheTable: props.jwkCacheTable,
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
    this.handler = handler;

    new CustomResource(this, id, {
      serviceToken: handler.functionArn,
      serviceTimeout: Duration.minutes(10), // caps CFN's default multi-hour wait
      properties: {
        bootstrapNonce: Date.now().toString(),
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
            adminUi: props.oauthClients.adminUi ? toRequestOAuthClient(props.oauthClients.adminUi) : undefined,
            jmapUi: props.oauthClients.jmapUi ? toRequestOAuthClient(props.oauthClients.jmapUi) : undefined,
          }
          : undefined,
        hostedZoneId: props.hostedZone?.hostedZoneId,
      },
    });

    props.configTable.grantReadWriteData(handler);
  }
}

export type {
  OidcProviderConfig,
  AuthPoliciesConfig,
  OAuthClientsConfig,
} from '../auth/types';
