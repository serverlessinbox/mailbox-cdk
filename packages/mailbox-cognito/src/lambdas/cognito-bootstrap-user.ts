import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

import { COGNITO_ARTIFACT_PACKAGE } from '../index';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';

export interface CognitoBootstrapUserLambdaProps {
  artifactResolver: IArtifactResolver;
}

/**
 * Artifact-based TypeScript Lambda for Cognito bootstrap user custom resource.
 *
 * Expects an artifact at: `lambdas/cognito-bootstrap-user.zip`
 * with handler: `index.handler`.
 */
export class CognitoBootstrapUserLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoBootstrapUserLambdaProps) {
    super(scope, id, {
      lambdaId: 'cognito-bootstrap-user',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      packageName: COGNITO_ARTIFACT_PACKAGE,
      timeout: Duration.minutes(2),
      memorySize: 256,
    });

    // Grant permission to check parent stack rollback status during custom-resource Update failures.
    // Scoped to this stack only — the Lambda checks the stack it's invoked for.
    this.grantCloudFormationDescribeStacks();
  }

  private grantCloudFormationDescribeStacks(): void {
    const stack = Stack.of(this);
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [stack.stackId],
      }),
    );
  }
}
