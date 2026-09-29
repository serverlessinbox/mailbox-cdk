import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';

import { IAdminApiAddon } from '../../api/addons';

export interface ArtifactUpdaterAddonProps {
  readonly updaterFunction: IFunction;
}

/**
 * Admin API addon for on-demand artifact updates.
 *
 * Mounts the ArtifactUpdaterLambda on the Admin API for:
 * - POST /artifact-updates/trigger: fire-and-forget async update dispatch
 *
 * The integration targets the already-constructed updater Lambda directly,
 * reusing it as a single-purpose function for all three trigger types (deploy-end CFN CR,
 * scheduled EventBridge, and admin-UI on-demand).
 *
 * Implements IAdminApiAddon.
 */
export class ArtifactUpdaterAddon implements IAdminApiAddon {
  constructor(private readonly props: ArtifactUpdaterAddonProps) {}

  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void {
    api.addRoutes({
      path: '/artifact-updates/{proxy+}',
      methods: [HttpMethod.POST, HttpMethod.GET],
      integration: new HttpLambdaIntegration('artifact-updates', this.props.updaterFunction),
      authorizer,
    });
  }
}
