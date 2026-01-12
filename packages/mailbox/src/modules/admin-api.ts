import { Construct } from "constructs";
import { AdminApiLambda } from "../lambdas";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Duration, Lazy } from "aws-cdk-lib";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { IAuthConfig } from "../auth/IAuthConfig";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { IArtifactResolver } from "../utils/artifact-resolver";


export interface AdminApiProps {
  configTable: ITable;
  itemTable: ITable;
  auditLogTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;
  allowedOrigins: string[];
  artifactResolver: IArtifactResolver;
  authConfig: IAuthConfig;
}

export class AdminApi extends Construct {
  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);


    const api = new HttpApi(this, 'admin-api', {
      apiName: 'Mailbox Service Admin API',
      description: 'This service serves mailbox admin api endpoints.',
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization', 'webrpc'],
        allowCredentials: true,
        maxAge: Duration.hours(1),
      },
    });

    const apiHandlerLambda = new AdminApiLambda(this, 'api-handler', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      auditLogTable: props.auditLogTable,
      changelogTable: props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      emailBucket: props.emailBucket,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    const authorizer = new HttpJwtAuthorizer('admin-jwt-authorizer', props.authConfig.issuer, {
      identitySource: ['$request.header.Authorization'],
      jwtAudience: Lazy.list({ produce: () => props.authConfig.clientIds }),
    });

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);
    api.addRoutes({
      integration: httpLambdaIntegration,
      path: '/{proxy+}',
      methods: [HttpMethod.POST],
      authorizer,
    });
  }
}