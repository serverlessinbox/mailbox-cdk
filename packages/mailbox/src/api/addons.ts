import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import type { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import type { IArtifactResolver } from '../artifacts/artifact-resolver';

export interface AdminApiAddon {
  /** Mount additional routes on the Admin API behind the same authorizer. */
  addRoutes(api: HttpApi, authorizer: HttpLambdaAuthorizer): void;
}

export type AdminApiAddonContext = {
  artifactResolver: IArtifactResolver;
  auditEventsQueue: IQueue;
};

/**
 * Optional capability for an AuthConfig implementation (e.g. Cognito) to register
 * additional Admin API routes without the core package knowing provider specifics.
 */
export interface AdminApiAddonProvider {
  createAdminApiAddons(scope: Construct, ctx: AdminApiAddonContext): AdminApiAddon[];
}
