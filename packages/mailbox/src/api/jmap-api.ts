import { Construct } from 'constructs';
import { AuthorizerLambda, ApiHandlerLambda, UserProvisionerLambda } from '../lambdas';
import type { JmapOAuthHandlerConfig } from '../lambdas/jmap-api';
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
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Duration, Aws } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { MailboxAuthProvider } from '../auth/types';
import { GoLambda } from '../utils/go-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { WebSocketBroadcastPublisher } from './websocket';

export interface JMapApiProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  authKeyStoreTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;

  /** OAuth clientId to advertise in the JMAP session response (must be JMAP_UI). */
  oauthClientId: string;

  cdnHost: string;
  allowedOrigins?: string[];

  webSocketUrl?: string;
  webSocketCapabilityDomain?: string;

  artifactResolver: IArtifactResolver;
  authProvider: MailboxAuthProvider;

  sesConfigSetName: string;

  /** Optional custom domain name for this API (e.g. jmap.example.com). */
  domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  certificate?: acm.ICertificate;
}

export class JMapApi extends Construct {
  url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  authorizerLambda: GoLambda; // Exposed for reuse in WebSocket API
  apiHandlerLambda: GoLambda; // Exposed to add WebSocket URL env var

  constructor(scope: Construct, id: string, props: JMapApiProps) {
    super(scope, id);

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      userPoolIssuer: props.authProvider.issuer,
      artifactResolver: props.artifactResolver,
    });

    this.authorizerLambda = lambdaAuthorizer;

    const api = new HttpApi(this, 'jmap-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} JMAP API`,
      description: 'This service serves mailbox operations.',
      corsPreflight:
        props.allowedOrigins && props.allowedOrigins.length > 0
          ? {
            allowOrigins: props.allowedOrigins,
            allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
            allowHeaders: ['Content-Type', 'Authorization'],
            allowCredentials: true,
            maxAge: Duration.hours(1),
          }
          : undefined,
    });

    if (props.domainName) {
      if (!props.certificate) {
        throw new Error('JMapApi: certificate is required when domainName is provided');
      }

      const domain = new DomainName(this, 'domain', {
        domainName: props.domainName,
        certificate: props.certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      });

      // Be explicit: the domain must be deleted before the certificate.
      domain.node.addDependency(props.certificate);

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

    const userProvisionerLambda = new UserProvisionerLambda(this, 'user-provisioner', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    const apiHandlerLambda = new ApiHandlerLambda(this, 'jmap-api-handler', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      authKeyStoreTable: props.authKeyStoreTable,
      emailBucket: props.emailBucket,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      cdnHost: props.cdnHost,
      apiBaseUrl: this.url,
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
      userProvisionionFunction: userProvisionerLambda,
      oauthHandlerConfig: {
        issuer: props.authProvider.issuer,
        tokenEndpoint: props.authProvider.tokenEndpoint,
        authorizationEndpoint: props.authProvider.authorizationEndpoint,
        clientId: props.oauthClientId,
        scopeMap: props.authProvider.scopeMap,
      } satisfies JmapOAuthHandlerConfig,
    });
    this.apiHandlerLambda = apiHandlerLambda;

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
    this.authorizerLambda = lambdaAuthorizer;

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);

    api.addRoutes({
      path: '/.well-known/jmap',
      methods: [HttpMethod.GET],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path: '/',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path: '/upload/{accountId}',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
  }

  public enableWebSocketPublishing(webSocketUrl: string, broadcaster: WebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.addEnvironment('WEBSOCKET_URL', webSocketUrl);

    this.apiHandlerLambda.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this.apiHandlerLambda);
  }
}
