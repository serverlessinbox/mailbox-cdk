import { CustomResource } from 'aws-cdk-lib';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

import { IArtifactResolver, createArtifactResolverFromContext } from '@sipkg/mailbox';

import { CognitoBootstrapUserLambda } from '../lambdas/cognito-bootstrap-user';

export interface BootstrapUserProps {
  userPool: IUserPool;
  username: string;
  email: string;
  groups: string[];

  /** Optional artifact resolver (defaults to context via `createArtifactResolverFromContext`). */
  artifactResolver?: IArtifactResolver;

  /** If true, Cognito will send an invite email (default: false / SUPPRESS). */
  sendInvite?: boolean;
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
