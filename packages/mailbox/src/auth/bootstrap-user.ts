import { CustomResource } from "aws-cdk-lib";
import { IUserPool } from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { BootstrapUserProperties } from "./bootstrap-user.handler";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

export interface BootstrapUserProps {
  userPool: IUserPool;
  username: string;
  email: string;
  groups: string[];
}

export class BootstrapUser extends Construct {
  constructor(scope: Construct, id: string, props: BootstrapUserProps) {
    super(scope, id);

    const handler = new NodejsFunction(this, 'handler')

    new CustomResource(this, id, {
      serviceToken: handler.functionArn,
      properties: {
        userPoolId: props.userPool.userPoolId,
        username: props.username,
        email: props.email,
        groups: props.groups,
      } as BootstrapUserProperties,
    });

    // Grant Cognito admin permissions
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [props.userPool.userPoolArn],
      })
    );
  }
}