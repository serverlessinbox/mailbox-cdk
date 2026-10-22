import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }   from '@serverlessinbox/mailbox-cdk-shared';
import type { VendorLink }        from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }   from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import type { CorsPreflightOptions }                                  from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration, Aws }                                              from 'aws-cdk-lib';
import { Construct }                                                  from 'constructs';

import { AUTH_POLICY_ADMIN_API }                                      from '../../contracts/auth-names';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget }    from '../../contracts/websocket-push';
import type { IDataBlobStore }                                        from '../../resources/buckets/data-blob-store';
import { AdminApiLambda }                                             from '../../resources/lambdas/admin-api-lambda';
import { AuthorizerLambda }                                           from '../../resources/lambdas/authorizer-lambda';
import type { IIdentityProvisioner }                                  from '../../resources/lambdas/identity-provisioner-lambda';
import type { IAuditEventsQueue }                                     from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                                    from '../../resources/queues/email-sending-queue';
import type { IAuthKeyStoreTable }                                    from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                            from '../../resources/tables/data-tables';

import type { IAdminApiAddon }                                        from './addons';
import { ApiCustomDomain }                                            from './api-custom-domain';
import type { ApiCustomDomainProps, ILogicalIdPin }                   from './api-custom-domain';

/**
 * Inputs of {@link AdminApi}: the tables, queues and blob store its handler Lambda works on, the
 * addons that mount further routes, and the optional custom domain.
 */
export interface AdminApiProps {
  readonly configTable:          IDataTable;
  readonly itemTable:            IDataTable;
  readonly auditLogTable:        IDataTable;
  readonly changelogTable:       IDataTable;
  readonly mailFeedbackTable:    IDataTable;
  readonly authKeyStoreTable:    IAuthKeyStoreTable;
  readonly blobStore:            IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue:     IAuditEventsQueue;
  /** Origins allowed by the API's CORS preflight. Without any, no CORS configuration is created. */
  readonly allowedOrigins?:     string[];
  readonly artifactResolver:    IArtifactResolver;
  readonly identityProvisioner: IIdentityProvisioner;

  /** Optional addons that mount extra endpoints on this Admin API (e.g. provider-specific APIs). */
  readonly addons?: IAdminApiAddon[];

  /** Optional custom domain (e.g. api.example.com) to serve this API on. */
  readonly customDomain?: ApiCustomDomainProps;

  /** Name of the SES receipt rule set. Passed to the handler for setup-flow SES readiness checks. */
  readonly sesRuleSetName: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
  /** The vendor accounts that scope the execute-api:Invoke permission and the tag key that identifies this stack's resources, resolved by the caller. */
  readonly vendorLink: VendorLink;
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
  /** Fixes the logical id of the custom domain name. Present only when a custom domain is set. */
  public readonly domainLogicalIdPin?: ILogicalIdPin;
  private readonly apiHandlerLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Administrative API for managing domains, users, configuration and audit.');

    const api = new HttpApi(this, 'admin-api', {
      apiName:       `Mailbox ${Aws.STACK_NAME} Admin API`,
      description:   'This service serves mailbox admin api endpoints.',
      corsPreflight: this.corsPreflight(props.allowedOrigins),
    });

    if (props.customDomain) {
      const domain = this.addCustomDomain(api, props.customDomain);

      this.url                = `https://${props.customDomain.domainName}`;
      this.domainTarget       = domain.regionalDomainName;
      this.domainLogicalIdPin = domain.logicalIdPin;
    } else {
      this.url = api.apiEndpoint;
    }

    this.apiHandlerLambda = this.createHandlerLambda(props);

    const httpLambdaAuthorize = this.createAuthorizer(props);

    for (const addon of props.addons ?? []) {
      addon.addRoutes(api, httpLambdaAuthorize);
    }

    api.addRoutes({
      integration: new HttpLambdaIntegration('handler', this.apiHandlerLambda),
      path:        '/{proxy+}',
      methods:     [HttpMethod.POST],
      authorizer:  httpLambdaAuthorize,
    });
  }

  /** Lets the handler Lambda publish through `broadcaster` to connected WebSocket clients. */
  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.enableWebSocketPush(broadcaster);
  }

  private corsPreflight(allowedOrigins: string[] | undefined): CorsPreflightOptions | undefined {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return undefined;
    }

    return {
      allowOrigins:     allowedOrigins,
      allowMethods:     [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
      allowHeaders:     ['Content-Type', 'Authorization'],
      allowCredentials: true,
      maxAge:           Duration.hours(1),
    };
  }

  private addCustomDomain(api: HttpApi, customDomain: ApiCustomDomainProps): ApiCustomDomain {
    const domain = new ApiCustomDomain(this, 'domain', customDomain);

    new ApiMapping(this, 'mapping', {
      api,
      domainName: domain,
    });

    return domain;
  }

  private createHandlerLambda(props: AdminApiProps): AdminApiLambda {
    return new AdminApiLambda(this, 'api-handler', {
      configTable:          props.configTable,
      itemTable:            props.itemTable,
      auditLogTable:        props.auditLogTable,
      changelogTable:       props.changelogTable,
      mailFeedbackTable:    props.mailFeedbackTable,
      blobStore:            props.blobStore,
      emailSubmissionQueue: props.emailSubmissionQueue,
      auditEventsQueue:     props.auditEventsQueue,
      artifactResolver:     props.artifactResolver,
      sesRuleSetName:       props.sesRuleSetName,
      sesConfigSetName:     props.sesConfigSetName,
      identityProvisioner:  props.identityProvisioner,
      systemSenderAddress:  props.systemSenderAddress,
      vendorLink:           props.vendorLink,
    });
  }

  private createAuthorizer(props: AdminApiProps): HttpLambdaAuthorizer {
    const lambdaAuthorizer = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable:       props.configTable,
      artifactResolver:  props.artifactResolver,
      authPolicyName:    AUTH_POLICY_ADMIN_API,
      serviceName:       'authorizer-admin-api',
      pipeline:          'admin',
    });

    return new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
  }
}
