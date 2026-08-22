import { Construct } from 'constructs';
import { AdminApiLambda, AuthorizerLambda } from '../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import {
  ApiMapping,
  CorsHttpMethod,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Duration, Aws, CfnResource } from 'aws-cdk-lib';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { AUTH_POLICY_ADMIN_API, IMailboxAuthProvider } from '../auth/types';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

import type { IAdminApiAddon } from './addons';
import type { IWebSocketBroadcastPublisher } from './websocket';

export interface AdminApiProps {
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly auditLogTable: ITable;
  readonly changelogTable: ITable;
  readonly mailFeedbackTable: ITable;
  readonly authKeyStoreTable: ITable;
  readonly blobStore: IBucket;
  readonly emailSubmissionQueue: IQueue;
  readonly auditEventsQueue: IQueue;
  readonly allowedOrigins?: string[];
  readonly artifactResolver: ICdkArtifactEngine;
  readonly authProvider: IMailboxAuthProvider;
  readonly identityProvisionerFunction: IFunction;

  /** Optional addons that mount extra endpoints on this Admin API (e.g. provider-specific APIs). */
  readonly addons?: IAdminApiAddon[];

  /** Optional custom domain name for this API (e.g. api.example.com). */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  readonly certificate?: acm.ICertificate;

  /** Name of the SES receipt rule set. Passed to the handler for setup-flow SES readiness checks. */
  readonly sesRuleSetName?: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
}

export class AdminApi extends Construct {
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  /** Exposed so callers can set additional env vars (e.g. SYSTEM_SENDER_ADDRESS) after construction. */
  public readonly apiHandlerLambda: AdminApiLambda;
  /** L1 CfnDomainName for logical-ID pinning. Present only when domainName is provided. */
  private _domainCfnResource?: CfnResource;

  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);

    const api = new HttpApi(this, 'admin-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} Admin API`,
      description: 'This service serves mailbox admin api endpoints.',
      corsPreflight:
        props.allowedOrigins && props.allowedOrigins.length > 0
          ? {
            allowOrigins: props.allowedOrigins,
            allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
            allowHeaders: ['Content-Type', 'Authorization'],
            allowCredentials: true,
            maxAge: Duration.hours(1),
          }
          : undefined,
    });

    if (props.domainName) {
      if (!props.certificate) {
        throw new Error('AdminApi: certificate is required when domainName is provided');
      }

      const domain = new DomainName(this, 'domain', {
        domainName: props.domainName,
        certificate: props.certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      // Be explicit: the domain must be deleted before the certificate.
      domain.node.addDependency(props.certificate);

      this._domainCfnResource = domain.node.defaultChild as CfnResource;

      new ApiMapping(this, 'mapping', {
        api,
        domainName: domain,
        stage: api.defaultStage!,
      });

      this.url = `https://${props.domainName}`;
      this.domainTarget = domain.regionalDomainName;
    } else {
      this.url = api.apiEndpoint;
    }

    const apiHandlerLambda = new AdminApiLambda(this, 'api-handler', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      auditLogTable: props.auditLogTable,
      changelogTable: props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      blobStore: props.blobStore,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
      sesRuleSetName: props.sesRuleSetName,
      sesConfigSetName: props.sesConfigSetName,
      identityProvisionerFunction: props.identityProvisionerFunction,
    });
    this.apiHandlerLambda = apiHandlerLambda;

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      userPoolIssuer: props.authProvider.issuer,
      artifactResolver: props.artifactResolver,
      authPolicyName: AUTH_POLICY_ADMIN_API,
    });

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);

    // Mount all addons at construction time
    for (const addon of props.addons ?? []) {
      addon.addRoutes(api, httpLambdaAuthorize);
    }

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);
    api.addRoutes({
      integration: httpLambdaIntegration,
      path: '/{proxy+}',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
    });
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this.apiHandlerLambda);
  }

  /** L1 CfnDomainName resource, for logical-ID pinning. Present only when domainName was provided. */
  public get domainCfnResource(): CfnResource | undefined {
    return this._domainCfnResource;
  }
}
