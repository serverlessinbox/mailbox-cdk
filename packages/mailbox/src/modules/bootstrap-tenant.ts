import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { BootstrapTenantLambda } from '../lambdas';
import { IArtifactResolver } from '../utils/artifact-resolver';
import {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from '../auth/types';

export interface BootstrapTenantProps {
  configTable: ITable;

  tenantName?: string;
  defaultLocalPart?: string;
  domain: string;
  oidcIssuer: string;
  oidcProviderName?: string;

  oidcProvider?: OidcProviderConfig;
  authPolicies?: AuthPoliciesConfig;
  oauthClients?: OAuthClientsConfig;

  artifactResolver: IArtifactResolver;
}

/**
 * CDK Construct for bootstrapping a new tenant
 *
 * Creates a custom resource that sets up tenant configuration during stack creation/update.
 * This includes:
 * - Tenant metadata (ID, name)
 * - Domain configuration
 * - OIDC provider setup
 * - Default email local part
 */
export class BootstrapTenant extends Construct {
  constructor(scope: Construct, id: string, props: BootstrapTenantProps) {
    super(scope, id);

    const toRequestOAuthClient = (client: OAuthAuthorizationCodeClientConfig) => ({
      requestedAudience: client.requestedAudience ?? client.clientId,
      clientId: client.clientId,
      clientSecret: client.clientSecret?.unsafeUnwrap(),
      scopes: client.scopes,
      redirectUri: client.redirectUri,
    });

    const handler = new BootstrapTenantLambda(this, 'handler', {
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
    });

    new CustomResource(this, id, {
      serviceToken: handler.functionArn,
      properties: {
        bootstrapNonce: Date.now().toString(),
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
