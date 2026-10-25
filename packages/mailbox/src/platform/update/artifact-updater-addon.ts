import { HttpMethod }                             from 'aws-cdk-lib/aws-apigatewayv2';
import type { IFunction }                         from 'aws-cdk-lib/aws-lambda';

import type { AdminApiRouteSpec, IAdminApiAddon } from '../../core/apis/addons';

/** Asks the Admin API to mount the artifact updater Lambda under `/artifact-updates` for POST and GET. */
export class ArtifactUpdaterAddon implements IAdminApiAddon {
  public readonly routeSpec: AdminApiRouteSpec;

  constructor(updaterFunction: IFunction) {
    this.routeSpec = {
      basePath: '/artifact-updates',
      methods:  [HttpMethod.POST, HttpMethod.GET],
      handler:  updaterFunction,
    };
  }
}
