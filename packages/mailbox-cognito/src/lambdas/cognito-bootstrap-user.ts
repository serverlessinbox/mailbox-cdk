import { Duration, Aws } from 'aws-cdk-lib';
import { Architecture, Code, Function as LambdaFunction, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../artifacts';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';

export interface CognitoBootstrapUserLambdaProps {
  artifactResolver: ICdkArtifactResolver;
}

/**
 * Artifact-based TypeScript Lambda for Cognito bootstrap user custom resource.
 *
 * Expects an artifact at: `lambdas/cognito-bootstrap-user.zip`
 * with handler: `index.handler`.
 */
export class CognitoBootstrapUserLambda extends Construct {
  public readonly fn: IFunction;

  constructor(scope: Construct, id: string, props: CognitoBootstrapUserLambdaProps) {
    super(scope, id);

    const code: Code = props.artifactResolver.getCode(COGNITO_ARTIFACT_PACKAGE, 'lambdas/cognito-bootstrap-user.zip');

    this.fn = new LambdaFunction(this, 'function', {
      code,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      memorySize: 256,
      description: `Serverless Inbox Mailbox: cognito-bootstrap-user (${Aws.STACK_NAME})`,
    });
  }
}
