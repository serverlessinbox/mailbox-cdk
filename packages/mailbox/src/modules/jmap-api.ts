import { Construct } from "constructs";
import { AuthorizerLambda, ApiHandlerLambda } from "../lambdas";
import {
  ApiMapping,
  CorsHttpMethod,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Duration } from "aws-cdk-lib";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { IArtifactResolver } from "../utils/artifact-resolver";
import { AuthConfig } from "../auth/types";
import { GoLambda } from "../utils/go-lambda";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface JMapApiProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;

  cdnHost: string;
  allowedOrigins?: string[];

  webSocketUrl?: string;
  webSocketCapabilityDomain?: string;

  artifactResolver: IArtifactResolver;
  authConfig: AuthConfig;

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
      jwkCacheTable: props.jwkCacheTable,
      configTable: props.configTable,
      userPoolIssuer: props.authConfig.issuer,
      artifactResolver: props.artifactResolver,
    });

    this.authorizerLambda = lambdaAuthorizer;

    // Example API Gateway
    const api = new HttpApi(this, 'jmap-api', {
      apiName: 'Mailbox Service',
      description: 'This service serves mailbox operations.',
      corsPreflight: props.allowedOrigins && props.allowedOrigins.length > 0
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

    // Example Go Lambda function
    const apiHandlerLambda = new ApiHandlerLambda(this, 'jmap-api-handler', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      jwkCacheTable: props.jwkCacheTable,
      emailBucket: props.emailBucket,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      cdnHost: props.cdnHost,
      apiBaseUrl: this.url,
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
    });
    this.apiHandlerLambda = apiHandlerLambda;

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('LambdaAuthorizer', lambdaAuthorizer, {
      identitySource: [], // Empty array allows requests without the header
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: Duration.minutes(0), // Disable caching for testing, set to higher value in production
    });
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

    // Keep this.url as the base URL for clients; routes are at / and /.well-known/jmap.
  }
}