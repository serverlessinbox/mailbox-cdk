import { CustomResource } from 'aws-cdk-lib';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

import { BootstrapUserProperties } from './bootstrap-user.handler';

export interface BootstrapUserProps {
  userPool: IUserPool;
  username: string;
  email: string;
  groups: string[];
}

export class BootstrapUser extends Construct {
  constructor(scope: Construct, id: string, props: BootstrapUserProps) {
    super(scope, id);

    const handler = new NodejsFunction(this, 'handler', {
      // Intentionally avoid CDK's logRetention here (it synthesizes a provider lambda).
    });

    new CustomResource(this, 'resource', {
      serviceToken: handler.functionArn,
      properties: {
        userPoolId: props.userPool.userPoolId,
        username: props.username,
        email: props.email,
        groups: props.groups,
      } as BootstrapUserProperties,
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
