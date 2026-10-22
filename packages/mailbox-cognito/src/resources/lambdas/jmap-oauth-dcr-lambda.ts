import type { IArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }          from '@serverlessinbox/mailbox-cdk-shared';
import type { IIdentityProvisioner } from '@serverlessinbox/mailbox';
import type { IUserPool }            from 'aws-cdk-lib/aws-cognito';
import { Duration }                  from 'aws-cdk-lib';
import { Construct }                 from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE }  from '../../cognito-artifact-package';

/** What `JmapOAuthDcrLambda` needs to resolve its code and to reach the user pool and the Lambda it works with. */
export interface JmapOAuthDcrLambdaProps {
  readonly artifactResolver: IArtifactResolver;

  /**
   * The `identity-provisioner` Lambda this construct invokes. Passed as an `IIdentityProvisioner` and not as an
   * ARN so that `grantInvoke` scopes the grant to it.
   */
  readonly identityProvisioner: IIdentityProvisioner;

  /** The Cognito user pool that dynamically registered clients are created in; scopes the Cognito permissions this Lambda grants itself. */
  readonly userPool: IUserPool;
}

/**
 * The Lambda behind `POST /oauth/register` (RFC 7591 Dynamic Client Registration). It is unauthenticated: no
 * authorizer is attached to its route.
 *
 * It grants itself invoke access to `identity-provisioner` and `CreateUserPoolClient` and `DeleteUserPoolClient`
 * on the one user pool, and nothing else in Cognito.
 */
export class JmapOAuthDcrLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: JmapOAuthDcrLambdaProps) {
    super(scope, id, {
      lambdaId:         'jmap-oauth-dcr',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      packageName:      COGNITO_ARTIFACT_PACKAGE,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        USER_POOL_ID:                       props.userPool.userPoolId,
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
      },
    });


    props.identityProvisioner.grantInvoke(this);

    props.userPool.grant(this, 'cognito-idp:CreateUserPoolClient', 'cognito-idp:DeleteUserPoolClient');
  }
}
