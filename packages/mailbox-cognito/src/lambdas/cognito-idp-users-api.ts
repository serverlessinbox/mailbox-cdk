import { Duration, Aws } from 'aws-cdk-lib';
import { Architecture, Code, Function as LambdaFunction, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

import { IArtifactResolver } from '@sipkg/mailbox';

import { COGNITO_LAMBDAS_ARTIFACT_PACKAGE } from '../artifacts';

export interface CognitoIdpUsersApiLambdaProps {
  artifactResolver: IArtifactResolver;

  /** Cognito user pool ID to manage. */
  userPoolId: string;

  /** Audit event queue URL (SQS). */
  auditEventsQueueUrl: string;
}

/**
 * Artifact-based TypeScript Lambda for Cognito user management endpoints.
 *
 * Expects an artifact at: `lambdas/cognito-idp-users-api.zip`
 * with handler: `index.handler`.
 */
export class CognitoIdpUsersApiLambda extends Construct {
  public readonly function: LambdaFunction;
  public readonly fn: IFunction;

  constructor(scope: Construct, id: string, props: CognitoIdpUsersApiLambdaProps) {
    super(scope, id);

    const code: Code = props.artifactResolver.getCode(COGNITO_LAMBDAS_ARTIFACT_PACKAGE, 'lambdas/cognito-idp-users-api.zip');

    this.function = new LambdaFunction(this, 'function', {
      code,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(15),
      memorySize: 256,
      description: `Serverless Inbox Mailbox: cognito-idp-users-api (${Aws.STACK_NAME})`,
      environment: {
        USER_POOL_ID: props.userPoolId,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueueUrl,
      },
    });

    this.fn = this.function;
  }
}
