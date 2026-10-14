import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';

import { IAdminApiAddon } from '../../api/addons';

/**
 * Mounts the artifact updater Lambda on the admin API under `/artifact-updates/{proxy+}` for POST
 * and GET, behind the admin API's authorizer.
 */
export class ArtifactUpdaterAddon implements IAdminApiAddon {
  constructor(private readonly updaterFunction: IFunction) {}

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: '/artifact-updates/{proxy+}',
      methods: [HttpMethod.POST, HttpMethod.GET],
      integration: new HttpLambdaIntegration('artifact-updates', this.updaterFunction),
      authorizer,
    });
  }
}
