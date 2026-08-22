import { Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../index';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';

export interface JmapOAuthDcrLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;

  /**
   * The `identity-provisioner` Lambda this construct invokes for tenant resolution
   * (`RESOLVE_TENANT`), dedup/cap checking (`DCR_CHECK`), and persistence (`DCR_PERSIST`).
   * Passed as an `IFunction` — never an ARN string — so `grantInvoke` can scope the grant.
   */
  readonly identityProvisionerFunction: IFunction;

  /**
   * The Cognito user pool that dynamically-registered clients are created against.
   *
   * Today this is the deployment's single configured pool. It is a constructor prop
   * (not read from a single env value) so a future per-tenant pool resolver can supply
   * a different value without changing this construct's shape (white-label hedge).
   */
  readonly userPoolId: string;

  /** ARN of the same pool, used to scope this Lambda's self-granted IAM policy. */
  readonly userPoolArn: string;
}

/**
 * Artifact-based TypeScript Lambda backing `POST /oauth/register` (RFC 7591 Dynamic Client
 * Registration). Unauthenticated — no Gateway authorizer is attached to its route.
 *
 * Cognito `CreateUserPoolClient`/`DeleteUserPoolClient` calls are self-granted on this
 * Lambda's own role, scoped to `userPoolArn` — mirrors `CognitoBootstrapUserLambda`'s
 * `addBootstrapUser` grant. `identity-provisioner` stays provider-agnostic and never
 * receives anything but an already-minted `clientId`.
 *
 * Expects an artifact at: `lambdas/jmap-oauth-dcr.zip` with handler: `index.handler`.
 */
export class JmapOAuthDcrLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: JmapOAuthDcrLambdaProps) {
    super(scope, id, {
      lambdaId: 'jmap-oauth-dcr',
      artifactResolver: props.artifactResolver,
      packageName: COGNITO_ARTIFACT_PACKAGE,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        USER_POOL_ID: props.userPoolId,
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisionerFunction.functionName,
      },
    });

    props.identityProvisionerFunction.grantInvoke(this);

    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:CreateUserPoolClient', 'cognito-idp:DeleteUserPoolClient'],
        resources: [props.userPoolArn],
      }),
    );
  }
}
