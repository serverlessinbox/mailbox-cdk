import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Construct, IDependable } from "constructs";
import { IdpTokenExchangeLambda } from "../../lambdas";
import type { Pipeline } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { IDataTable } from '../../data/data-tables';
import type { IAuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import {
  AuthPolicyName,
  OAuthClientName,
  AUTH_POLICY_ADMIN_API,
} from "../../auth/types";
import { Aws } from 'aws-cdk-lib';

export interface IdpTokenExchangeApiProps {
  artifactResolver: IArtifactResolver;
  configTable: IDataTable;
  auditEventsQueue: IAuditEventsQueue;

  /**
   * Name of AUTH_POLICY record to use (e.g. ADMIN_API).
   */
  authPolicyName?: AuthPolicyName;

  /**
   * Name of OAUTH_CLIENT record to use (e.g. ADMIN_UI).
   */
  oauthClientName: OAuthClientName;

  /** Resources that must be deployed before the token-exchange function is created or updated. */
  dependsOn?: IDependable[];

  /** SERVICE_NAME for the underlying IdpTokenExchangeLambda; distinguishes callers of this API. */
  serviceName: string;

  /** Pipeline for the underlying IdpTokenExchangeLambda: 'admin' for Admin UI, 'jmap' for Webmail UI. */
  readonly pipeline: Pipeline;
}

export class IdpTokenExchangeApi extends Construct {
  public readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: IdpTokenExchangeApiProps) {
    super(scope, id);

    this.api = new HttpApi(this, 'idp-token-exchange-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} IDP Token Exchange API`,
      description: 'This service serves IDP token exchange endpoints.',
    });

    const apiHandlerLambda = new IdpTokenExchangeLambda(this, 'idp-token-exchange-lambda', {
      configTable: props.configTable,
      auditEventsQueue: props.auditEventsQueue,
      authPolicyName: props.authPolicyName ?? AUTH_POLICY_ADMIN_API,
      oauthClientName: props.oauthClientName,
      artifactResolver: props.artifactResolver,
      serviceName: props.serviceName,
      pipeline: props.pipeline,
    });
    apiHandlerLambda.node.addDependency(...(props.dependsOn ?? []));

    this.api.addRoutes({
      path: '/auth/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('idp-token-exchange-integration', apiHandlerLambda),
    });
  }
}