import { CustomResource } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { BootstrapLambda } from '../lambdas';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import {
  AuthPoliciesConfig,
  OAuthClientsConfig,
  OAuthAuthorizationCodeClientConfig,
  OidcProviderConfig,
} from '../auth/types';

export interface BootstrapProps {
  configTable: ITable;
  jwkCacheTable: ITable;

  tenantName?: string;
  defaultLocalPart?: string;
  domain: string;
  oidcIssuer: string;
  oidcProviderName?: string;

  oidcProvider?: OidcProviderConfig;
  authPolicies?: AuthPoliciesConfig;
  oauthClients?: OAuthClientsConfig;

  artifactResolver: IArtifactResolver;
  sesRuleSetName?: string;
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
      artifactResolver: props.artifactResolver,
    });
    this.handler = handler;

    const cr = new CustomResource(this, id, {
      serviceToken: handler.functionArn,
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
      },
    });

    props.configTable.grantReadWriteData(handler);

    if (props.sesRuleSetName) {
      handler.addEnvironment('SES_RULE_SET_NAME', props.sesRuleSetName);
      handler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:SetActiveReceiptRuleSet'],
        resources: ['*'],
      }));
    }
  }
}

export type {
  OidcProviderConfig,
  AuthPoliciesConfig,
  OAuthClientsConfig,
} from '../auth/types';
