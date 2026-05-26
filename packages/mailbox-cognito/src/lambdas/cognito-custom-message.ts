import { Duration } from 'aws-cdk-lib';
import { Architecture, Runtime, Function as LambdaFunction, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { IArtifactResolver } from '@serverlessinbox/mailbox';

import { COGNITO_LAMBDAS_ARTIFACT_PACKAGE } from '../artifacts';

export interface CognitoCustomMessageLambdaProps {
  artifactResolver: IArtifactResolver;

  /** Optional login URL to include in templates. */
  loginUrl?: string;

  /** Optional support/contact line appended to emails. */
  supportText?: string;
}

/**
 * Artifact-based Lambda for Cognito Custom Message trigger.
 *
 * Expects an artifact at: `lambdas/cognito-custom-message.zip`
 * with handler: `index.handler`.
 */
export class CognitoCustomMessageLambda extends Construct {
  public readonly fn: IFunction;

  constructor(scope: Construct, id: string, props: CognitoCustomMessageLambdaProps) {
    super(scope, id);

    this.fn = new LambdaFunction(this, 'function', {
      code: props.artifactResolver.getCode(COGNITO_LAMBDAS_ARTIFACT_PACKAGE, 'lambdas/cognito-custom-message.zip'),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      memorySize: 128,
      description: `Serverless Inbox Mailbox: cognito-custom-message (${Aws.STACK_NAME})`,
      environment: {
        LOGIN_URL: props.loginUrl ?? '',
        SUPPORT_TEXT: props.supportText ?? '',
      },
    });
  }
}
