import type { IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import type { Pipeline }           from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaIntegration }   from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpApi, HttpMethod }     from 'aws-cdk-lib/aws-apigatewayv2';
import { Aws }                     from 'aws-cdk-lib';
import { Construct, IDependable }  from 'constructs';

import type {
  AuthPolicyName,
  OAuthClientName,
} from '../../contracts/auth-names';
import { IdpTokenExchangeLambda }  from '../../resources/lambdas/idp-token-exchange-lambda';
import type { IAuditEventsQueue }  from '../../resources/queues/audit-events-queue';
import type { IDataTable }         from '../../resources/tables/data-tables';

/** Props of {@link IdpTokenExchangeApi}. */
export interface IdpTokenExchangeApiProps {
  readonly artifactResolver: IArtifactResolver;
  readonly configTable:      IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;

  /**
   * Name of AUTH_POLICY record to use (e.g. ADMIN_API).
   */
  readonly authPolicyName: AuthPolicyName;

  /**
   * Name of OAUTH_CLIENT record to use (e.g. ADMIN_UI).
   */
  readonly oauthClientName: OAuthClientName;

  /** Resources that must be deployed before the token-exchange function is created or updated. */
  readonly dependsOn?: IDependable[];

  /** SERVICE_NAME for the underlying IdpTokenExchangeLambda; distinguishes callers of this API. */
  readonly serviceName: string;

  /** Pipeline for the underlying IdpTokenExchangeLambda: 'admin' for Admin UI, 'jmap' for Webmail UI. */
  readonly pipeline: Pipeline;
}

/**
 * The HTTP API that serves the `/auth/*` token-exchange routes of a UI, backed by one
 * {@link IdpTokenExchangeLambda}.
 */
export class IdpTokenExchangeApi extends Construct {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: IdpTokenExchangeApiProps) {
    super(scope, id);

    this.api = new HttpApi(this, 'idp-token-exchange-api', {
      apiName:            `Mailbox ${Aws.STACK_NAME} IDP Token Exchange API`,
      createDefaultStage: false,
      description:        'This service serves IDP token exchange endpoints.',
    });
    this.api.addStage('DefaultStage', {
      autoDeploy: true,
      throttle:   { rateLimit: 100, burstLimit: 200 },
    });

    const apiHandlerLambda = new IdpTokenExchangeLambda(this, 'idp-token-exchange-lambda', {
      configTable:      props.configTable,
      auditEventsQueue: props.auditEventsQueue,
      authPolicyName:   props.authPolicyName,
      oauthClientName:  props.oauthClientName,
      artifactResolver: props.artifactResolver,
      serviceName:      props.serviceName,
      pipeline:         props.pipeline,
      dependsOn:        props.dependsOn,
    });

    this.api.addRoutes({
      path:        '/auth/{proxy+}',
      methods:     [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('idp-token-exchange-integration', apiHandlerLambda),
    });
  }
}
