import { Construct } from "constructs";
import { AuthorizerLambda, ApiHandlerLambda } from "../lambdas";
import { HttpApi, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpMethod } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Duration } from "aws-cdk-lib";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { IArtifactResolver } from "../utils/artifact-resolver";
import { IAuthConfig } from "../auth/IAuthConfig";
import { GoLambda } from "../utils/go-lambda";

export interface JMapApiProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;

  cdnHost: string;
  allowedOrigins: string[];

  webSocketUrl?: string;
  webSocketCapabilityDomain?: string;

  artifactResolver: IArtifactResolver;
  authConfig: IAuthConfig;

  sesConfigSetName: string;
}

export class JMapApi extends Construct {
  url: string;
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
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
        maxAge: Duration.hours(1),
      },
    });

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
      apiBaseUrl: api.apiEndpoint,
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

    this.url = api.url!
  }
}