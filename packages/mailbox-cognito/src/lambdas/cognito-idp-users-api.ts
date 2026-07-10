import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../index';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';

export interface CognitoIdpUsersApiLambdaProps {
  artifactResolver: ICdkArtifactEngine;

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
export class CognitoIdpUsersApiLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoIdpUsersApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'cognito-idp-users-api',
      artifactResolver: props.artifactResolver,
      packageName: COGNITO_ARTIFACT_PACKAGE,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        USER_POOL_ID: props.userPoolId,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueueUrl,
      },
    });
  }
}
