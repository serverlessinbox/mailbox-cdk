import { CustomResource } from 'aws-cdk-lib';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { IArtifactResolver, createArtifactResolverFromContext } from '@serverlessinbox/mailbox';

import { CognitoBootstrapUserLambda } from '../lambdas/cognito-bootstrap-user';

export interface BootstrapUserProps {
  readonly userPool: IUserPool;
  /** Defaults to `"admin"` if not provided. */
  readonly username?: string;
  /** Email address for the bootstrap user. Required unless `temporaryPassword` is set. */
  readonly email?: string;
  readonly groups: string[];

  /**
   * One-time temporary bootstrap password. When set, the user is created in
   * FORCE_CHANGE_PASSWORD state and must change it on first login.
   * This is a temporary credential only — never use for permanent passwords.
   */
  readonly temporaryPassword?: string;

  /** Optional artifact resolver (defaults to context via `createArtifactResolverFromContext`). */
  readonly artifactResolver?: IArtifactResolver;

  /** If true, Cognito will send an invite email (default: false / SUPPRESS). */
  readonly sendInvite?: boolean;
}

export class BootstrapUser extends Construct {
  constructor(scope: Construct, id: string, props: BootstrapUserProps) {
    super(scope, id);

    const artifactResolver = props.artifactResolver ?? createArtifactResolverFromContext(this);
    const handler = new CognitoBootstrapUserLambda(this, 'handler', { artifactResolver }).fn;

    new CustomResource(this, 'bootstrap', {
      resourceType: 'Custom::CognitoBootstrapUser',
      serviceToken: handler.functionArn,
      properties: {
        userPoolId: props.userPool.userPoolId,
        username: props.username,
        email: props.email,
        groups: props.groups,
        sendInvite: props.sendInvite ?? false,
        temporaryPassword: props.temporaryPassword,
      },
    });

    handler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [props.userPool.userPoolArn],
      }),
    );
  }
}
