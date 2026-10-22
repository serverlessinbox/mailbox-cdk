import type { IArtifactResolver }   from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }         from '@serverlessinbox/mailbox-cdk-shared';
import type { IUserPool }           from 'aws-cdk-lib/aws-cognito';
import * as iam                     from 'aws-cdk-lib/aws-iam';
import { Duration, Stack }          from 'aws-cdk-lib';
import { Construct }                from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../../cognito-artifact-package';

/** What `CognitoBootstrapUserLambda` needs to resolve its code artifact and to scope its grant to the pool it administers. */
export interface CognitoBootstrapUserLambdaProps {
  artifactResolver: IArtifactResolver;
  userPool:         IUserPool;
}

/** The Lambda behind the bootstrap user custom resource: it creates the user in the pool and adds it to its groups. */
export class CognitoBootstrapUserLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoBootstrapUserLambdaProps) {
    super(scope, id, {
      lambdaId:         'cognito-bootstrap-user',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      packageName:      COGNITO_ARTIFACT_PACKAGE,
      timeout:          Duration.minutes(2),
      memorySize:       256,
    });

    this.grantCloudFormationDescribeStacks();
    this.grantUserPoolBootstrap(props.userPool);
  }

  private grantCloudFormationDescribeStacks(): void {
    const stack = Stack.of(this);
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions:   ['cloudformation:DescribeStacks'],
        resources: [stack.stackId],
      }),
    );
  }

  private grantUserPoolBootstrap(userPool: IUserPool): void {
    userPool.grant(this, 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminAddUserToGroup');
  }
}
