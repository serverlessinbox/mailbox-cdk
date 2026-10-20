import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { HttpLambdaAuthorizer }   from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  CorsHttpMethod,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                                                    from 'aws-cdk-lib/aws-certificatemanager';
import { Duration, Aws, CfnResource }                              from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import { AUTH_POLICY_ADMIN_API }                                   from '../../auth/types';
import type { IDataBlobStore }                                     from '../../data/data-blob-store';
import type { IDataTable }                                         from '../../data/data-tables';
import type { IEmailSendingQueue }                                 from '../../email/sending/email-sending-queue';
import type { IAuditEventsQueue }                                  from '../../features/audit-writing/audit-events-queue';
import type { IAuthKeyStoreTable }                                 from '../../features/auth-key-store/auth-key-store-table';
import type { IIdentityProvisioner }                               from '../../lambdas/identity-provisioner';
import { AdminApiLambda, AuthorizerLambda }                        from '../../lambdas';
import type { IAdminApiAddon }                                     from '../addons';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../websocket/websocket';

/**
 * Inputs of {@link AdminApi}: the tables, queues and blob store its handler Lambda works on, the
 * addons that mount further routes, and the optional custom domain.
 */
export interface AdminApiProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly auditLogTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue: IAuditEventsQueue;
  /** Origins allowed by the API's CORS preflight. Without any, no CORS configuration is created. */
  readonly allowedOrigins?: string[];
  readonly artifactResolver: IArtifactResolver;
  readonly identityProvisioner: IIdentityProvisioner;

  /** Optional addons that mount extra endpoints on this Admin API (e.g. provider-specific APIs). */
  readonly addons?: IAdminApiAddon[];

  /** Optional custom domain name for this API (e.g. api.example.com). */
  readonly domainName?: string;

  /** ACM certificate for domainName (must be regional, in the same region as the stack/API). Required when domainName is set. */
  readonly certificate?: acm.ICertificate;

  /** Name of the SES receipt rule set. Passed to the handler for setup-flow SES readiness checks. */
  readonly sesRuleSetName: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key used to identify resources belonging to this stack, sourced from the tag-key registry. */
  readonly stackIdentityTagKey: string;
}

/**
 * The Admin HTTP API: one proxy route to the admin-api handler Lambda behind a Lambda authorizer,
 * the routes its addons mount, and an optional custom domain.
 *
 * It does not create the DNS record for the custom domain (it exposes `domainTarget` for that),
 * and it does not decide who is authorized (the authorizer Lambda does).
 */
export class AdminApi extends Construct {
  /** The API's base URL: `https://<domainName>` with a custom domain, the API Gateway endpoint otherwise. */
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  /** L1 CfnDomainName for logical-ID pinning. Present only when domainName is provided. */
  public readonly domainCfnResource?: CfnResource;
  private readonly apiHandlerLambda: IWebSocketPushTarget;

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

      this.domainCfnResource = domain.node.defaultChild as CfnResource;

      new ApiMapping(this, 'mapping', {
        api,
        domainName: domain,
        stage: api.defaultStage!,
      });

      this.url          = `https://${props.domainName}`;
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
      identityProvisioner: props.identityProvisioner,
      systemSenderAddress: props.systemSenderAddress,
      vendorAccountIds: props.vendorAccountIds,
      stackIdentityTagKey: props.stackIdentityTagKey,
    });
    this.apiHandlerLambda  = apiHandlerLambda;

    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable: props.configTable,
      artifactResolver: props.artifactResolver,
      authPolicyName: AUTH_POLICY_ADMIN_API,
      serviceName: 'authorizer-admin-api',
      pipeline: 'admin',
    });

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);

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

  /** Lets the handler Lambda publish through `broadcaster` to connected WebSocket clients. */
  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.enableWebSocketPush(broadcaster);
  }
}
