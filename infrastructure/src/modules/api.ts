import { Construct } from "constructs";
import { GoLambda } from "../utils/go-lambda";
import { HttpApi, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpMethod } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { IUserPool } from "aws-cdk-lib/aws-cognito";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { UserPool } from "../constructs/user-pool";
import { Duration } from "aws-cdk-lib";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { ILambdaCodeProvider } from "../utils/lambda-code-provider";

export interface AdminApiProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  defaultDomain: string;
  userPool: UserPool;
  cdnHost: string;
  allowedOrigins: string[];
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  webSocketUrl?: string;
  webSocketCapabilityDomain?: string;
  codeProvider: ILambdaCodeProvider;
}

export class JMapApi extends Construct {
  url: string;
  authorizerLambda: any; // Exposed for reuse in WebSocket API
  apiHandlerLambda: any; // Exposed to add WebSocket URL env var

  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);

    const lambdaAuthorizer = new GoLambda(this, 'lambda-authorizer', {
      lambdaId: 'authorizer',
      codeProvider: props.codeProvider,
      memorySize: 256,
      environment: {
        USER_POOL_ISSUER: props.userPool.issuer,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ALLOW_ANONYMOUS: 'true',
        // Stable identifier extraction (resilient to IDP recreation)
        STABLE_ID_PRIORITY: 'email,username,preferred_username,cognito:username,sub',
        PREFERRED_USERNAME_CLAIM: 'username',
      },
    });

    this.authorizerLambda = lambdaAuthorizer;

    props.jwkCacheTable.grantReadData(lambdaAuthorizer);
    props.configTable.grantReadData(lambdaAuthorizer);

    // Example API Gateway
    const api = new HttpApi(this, 'api', {
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

    // Note: HTTP API (API Gateway v2) automatically handles binary content
    // No need for special binaryMediaTypes configuration like REST API (v1)

    // Example Go Lambda function
    const apiHandlerLambda = new GoLambda(this, 'api-handler', {
      lambdaId: 'api-handler',
      codeProvider: props.codeProvider,
      memorySize: 640,
      environment: {
        // Example environment variables
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        DEFAULT_EMAIL_DOMAIN: props.defaultDomain,
        USER_POOL_ID: props.userPool.userPool.userPoolId,
        CDN_HOST: props.cdnHost,
        API_BASE_URL: api.apiEndpoint,
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        // Cognito OAuth2 Configuration
        COGNITO_REGION: props.userPool.userPool.stack.region,
        COGNITO_CLIENT_ID: props.userPool.userPoolClient.userPoolClientId,
        COGNITO_DOMAIN: `https://${props.userPool.userPoolDomain.domainName}.auth.${props.userPool.userPool.stack.region}.amazoncognito.com`,
        // WebSocket extension (optional) - added after WebSocket is created
      },
    });

    this.apiHandlerLambda = apiHandlerLambda;

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.configTable.grantReadWriteData(apiHandlerLambda);
    props.itemTable.grantReadWriteData(apiHandlerLambda);
    props.changelogTable.grantReadWriteData(apiHandlerLambda);
    // Grant S3 write permissions for blob uploads
    props.emailBucket.grantReadWrite(apiHandlerLambda);

    // Grant SQS permissions to send email submission messages
    props.emailSubmissionQueue.grantSendMessages(apiHandlerLambda);

    // Grant Cognito admin permissions to create/manage users
    props.userPool.grantAdminAccess(apiHandlerLambda);

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('LambdaAuthorizer', lambdaAuthorizer, {
      identitySource: [], // Empty array allows requests without the header
      responseTypes: [HttpLambdaResponseType.SIMPLE], 
      resultsCacheTtl: Duration.minutes(0), // Disable caching for testing, set to higher value in production
    });

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);

    api.addRoutes({
      path: '/.well-known/jmap',
      methods: [HttpMethod.GET],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
    api.addRoutes({
      path: '/jmap',
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