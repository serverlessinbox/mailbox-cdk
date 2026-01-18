import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import { IdpTokenExchangeLambda } from "../../lambdas";
import { IArtifactResolver } from "../../artifacts/artifact-resolver";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import {
  AuthPolicyName,
  OAuthClientName,
  AUTH_POLICY_ADMIN_API,
  OAUTH_CLIENT_ADMIN_UI,
} from "../../auth/types";
import { Aws } from 'aws-cdk-lib';

export interface IdpTokenExchangeApiProps {
  artifactResolver: IArtifactResolver;
  configTable: ITable;

  /**
   * Name of AUTH_POLICY record to use (e.g. ADMIN_API).
   */
  authPolicyName?: AuthPolicyName;

  /**
   * Name of OAUTH_CLIENT record to use (e.g. ADMIN_UI).
   */
  oauthClientName?: OAuthClientName;
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
      authPolicyName: props.authPolicyName ?? AUTH_POLICY_ADMIN_API,
      oauthClientName: props.oauthClientName ?? OAUTH_CLIENT_ADMIN_UI,
      artifactResolver: props.artifactResolver,
    });

    this.api.addRoutes({
      path: '/auth/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('idp-token-exchange-integration', apiHandlerLambda),
    });
  }
}