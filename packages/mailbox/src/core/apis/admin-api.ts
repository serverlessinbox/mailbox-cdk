import type { IArtifactResolver }                                     from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }                                       from '@serverlessinbox/mailbox-cdk-shared';
import type { VendorLink }                                            from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }                                       from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpMethod }                                                 from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration }                                                   from 'aws-cdk-lib';
import { Construct }                                                  from 'constructs';

import { AuthPolicyName }                                             from '../../contracts/auth-names';
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
import type { ApiRoute, IApiArea }                                    from './api-area';

/**
 * Inputs of {@link AdminApi}: the tables, queues and blob store its handler Lambda works on, and the
 * addons that mount further routes.
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
  readonly artifactResolver:     IArtifactResolver;
  readonly identityProvisioner:  IIdentityProvisioner;

  /** Optional addons that mount extra endpoints on this Admin API (e.g. provider-specific APIs). */
  readonly addons?: IAdminApiAddon[];

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
 * The admin area: the admin-api handler Lambda behind a Lambda authorizer, and the routes its addons
 * mount behind a principal-lookup authorizer. Every route is served under `/admin`.
 *
 * It does not decide who is authorized (the authorizer Lambda does).
 */
export class AdminApi extends Construct implements IApiArea {
  /** The area's routes: the addon routes, then the handler route. */
  public readonly routes: ApiRoute[];

  private readonly apiHandlerLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Administrative API for managing domains, users, configuration and audit.');

    const handler             = this.createHandlerLambda(props);
    const httpLambdaAuthorize = this.createAuthorizer(props);
    const lookupAuthorize     = this.createLookupAuthorizer(props);

    this.apiHandlerLambda = handler;

    this.routes = [
      ...this.addonRoutes(lookupAuthorize, props.addons ?? []),
      {
        path:          '/admin/{proxy+}',
        methods:       [HttpMethod.POST],
        integrationId: 'handler',
        handler,
        authorizer:    httpLambdaAuthorize,
      },
    ];
  }

  /** Lets the handler Lambda publish through `broadcaster` to connected WebSocket clients. */
  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.apiHandlerLambda.enableWebSocketPush(broadcaster);
  }

  private addonRoutes(authorizer: HttpLambdaAuthorizer, addons: IAdminApiAddon[]): ApiRoute[] {
    const mountedBasePaths   = new Set<string>();
    const routes: ApiRoute[] = [];

    for (const { routeSpec } of addons) {
      if (!routeSpec) {
        continue;
      }

      if (mountedBasePaths.has(routeSpec.basePath)) {
        throw new Error(`Two Admin API addons use the base path '${routeSpec.basePath}'; each addon needs its own.`);
      }
      mountedBasePaths.add(routeSpec.basePath);

      routes.push({
        path:          `/admin${routeSpec.basePath}/{proxy+}`,
        methods:       routeSpec.methods,
        integrationId: routeSpec.basePath.replace(/^\//, ''),
        handler:       routeSpec.handler,
        authorizer,
      });
    }

    return routes;
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
      authPolicyName:    AuthPolicyName.ADMIN_API,
      serviceName:       'authorizer-admin-api',
      pipeline:          'admin',
    });

    return new HttpLambdaAuthorizer('authorizer', lambdaAuthorizer);
  }

  private createLookupAuthorizer(props: AdminApiProps): HttpLambdaAuthorizer {
    const lookupLambdaAuthorizer = new AuthorizerLambda(this, 'lookup-lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable:       props.configTable,
      artifactResolver:  props.artifactResolver,
      authPolicyName:    AuthPolicyName.ADMIN_API,
      principalLookup:   true,
      serviceName:       'authorizer-admin-api-lookup',
      pipeline:          'admin',
    });

    return new HttpLambdaAuthorizer('lookup-authorizer', lookupLambdaAuthorizer, {
      resultsCacheTtl: Duration.minutes(1),
    });
  }
}
