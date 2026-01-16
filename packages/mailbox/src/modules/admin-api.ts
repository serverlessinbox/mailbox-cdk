import { Construct } from "constructs";
import { AdminApiLambda, AuthorizerLambda } from "../lambdas";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
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
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Duration } from "aws-cdk-lib";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { IArtifactResolver } from "../utils/artifact-resolver";
import { AUTH_POLICY_ADMIN_API, AuthConfig } from "../auth/types";
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Aws } from 'aws-cdk-lib';


export interface AdminApiProps {
  configTable: ITable;
  itemTable: ITable;
  auditLogTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  jwkCacheTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;
  allowedOrigins?: string[];
  artifactResolver: IArtifactResolver;
  authConfig: AuthConfig;

  /** Optional custom domain name for this API (e.g. api.example.com). */
  domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). */
  certificate?: acm.ICertificate;
}

export class AdminApi extends Construct {
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;

  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);


    const api = new HttpApi(this, 'admin-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} Admin API`,
      description: 'This service serves mailbox admin api endpoints.',
      corsPreflight: props.allowedOrigins && props.allowedOrigins.length > 0
        ? {
          allowOrigins: props.allowedOrigins,
          allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
          allowHeaders: ['Content-Type', 'Authorization', 'webrpc'],
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
      emailBucket: props.emailBucket,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      jwkCacheTable: props.jwkCacheTable,
      configTable: props.configTable,
      userPoolIssuer: props.authConfig.issuer,
      artifactResolver: props.artifactResolver,
      authPolicyName: AUTH_POLICY_ADMIN_API,
      allowAnonymous: false,
    });

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('LambdaAuthorizer', lambdaAuthorizer, {
      identitySource: [],
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: Duration.minutes(0),
    });

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', apiHandlerLambda);
    api.addRoutes({
      integration: httpLambdaIntegration,
      path: '/{proxy+}',
      methods: [HttpMethod.POST],
      authorizer: httpLambdaAuthorize,
    });
  }
}