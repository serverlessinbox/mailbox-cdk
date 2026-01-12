import { CustomResource } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { BootstrapTenantLambda } from '../lambdas';
import { IArtifactResolver } from '../utils/artifact-resolver';
import { SecretValue } from 'aws-cdk-lib';

export interface BootstrapOIDCProviderProps {
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  authMethod?: 'header' | 'form';
  usePkce?: boolean;
}

export interface BootstrapAuthPolicyProps {
  audiences?: string[];
  requiredGroup?: string;
}

export interface BootstrapAuthPoliciesProps {
  adminApi?: BootstrapAuthPolicyProps;
  jmapApi?: BootstrapAuthPolicyProps;
}

export interface BootstrapOAuthClientProps {
  requestedAudience?: string;
  clientId?: string;
  clientSecret?: SecretValue;
  scopes?: string[];
  redirectUri?: string;
}

export interface BootstrapOAuthClientsProps {
  adminUi: BootstrapOAuthClientProps;
  jmapUi?: BootstrapOAuthClientProps;
}

export interface BootstrapTenantProps {
  configTable: ITable;

  tenantName?: string;
  defaultLocalPart?: string;
  domain: string;
  oidcIssuer: string;
  oidcProviderName?: string;

  oidcProvider?: BootstrapOIDCProviderProps;
  authPolicies?: BootstrapAuthPoliciesProps;
  oauthClients: BootstrapOAuthClientsProps;

  artifactResolver: IArtifactResolver;
}

interface CustomResourceRequestOIDCProvider {
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  authMethod?: 'header' | 'form';
  usePkce?: boolean;
}

interface CustomResourceRequestAuthPolicy {
  audiences?: string[];
  requiredGroup?: string;
}

interface CustomResourceRequestAuthPolicies {
  adminApi?: CustomResourceRequestAuthPolicy;
  jmapApi?: CustomResourceRequestAuthPolicy;
}

interface CustomResourceRequestOAuthClient {
  requestedAudience?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  redirectUri?: string;
}

interface CustomResourceRequestOAuthClients {
  adminUi: CustomResourceRequestOAuthClient;
  jmapUi?: CustomResourceRequestOAuthClient;
}

interface CustomResourceRequestProperties {
  tenantName: string;
  defaultLocalPart: string;
  domain: string;
  oidcIssuer: string;
  oidcProviderName?: string;

  // Forces CloudFormation to run the custom resource on every deploy.
  // Useful in dev when the config table can be cleared out-of-band.
  bootstrapNonce: string;

  oidcProvider?: CustomResourceRequestOIDCProvider;
  authPolicies?: CustomResourceRequestAuthPolicies;
  oauthClients: CustomResourceRequestOAuthClients;
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
        oauthClients: {
          adminUi: {
            requestedAudience: props.oauthClients.adminUi.requestedAudience,
            clientId: props.oauthClients.adminUi.clientId,
            clientSecret: props.oauthClients.adminUi.clientSecret
              ? props.oauthClients.adminUi.clientSecret.unsafeUnwrap()
              : undefined,
            scopes: props.oauthClients.adminUi.scopes,
            redirectUri: props.oauthClients.adminUi.redirectUri,
          },
          jmapUi: props.oauthClients.jmapUi
            ? {
              requestedAudience: props.oauthClients.jmapUi.requestedAudience,
              clientId: props.oauthClients.jmapUi.clientId,
              clientSecret: props.oauthClients.jmapUi.clientSecret
                ? props.oauthClients.jmapUi.clientSecret.unsafeUnwrap()
                : undefined,
              scopes: props.oauthClients.jmapUi.scopes,
              redirectUri: props.oauthClients.jmapUi.redirectUri,
            }
            : undefined,
        },
      } as CustomResourceRequestProperties,
    });

    props.configTable.grantReadWriteData(handler);
  }
}
