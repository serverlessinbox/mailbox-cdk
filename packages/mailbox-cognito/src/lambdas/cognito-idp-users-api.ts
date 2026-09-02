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

  /** Optional admin group names (JSON-encoded array). */
  readonly adminGroups?: string;

  /** Optional user group names (JSON-encoded array). */
  readonly userGroups?: string;
}

/**
 * Artifact-based TypeScript Lambda for Cognito user management endpoints.
 *
 * Expects an artifact at: `lambdas/cognito-idp-users-api.zip`
 * with handler: `index.handler`.
 */
export class CognitoIdpUsersApiLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoIdpUsersApiLambdaProps) {
    const environment: Record<string, string> = {
      USER_POOL_ID: props.userPoolId,
      AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueueUrl,
    };

    // Only set authorization groups if provided
    if (props.adminGroups !== undefined) {
      environment.ADMIN_GROUPS = props.adminGroups;
    }
    if (props.userGroups !== undefined) {
      environment.USER_GROUPS = props.userGroups;
    }

    super(scope, id, {
      lambdaId: 'cognito-idp-users-api',
      pipeline: 'admin',
      artifactResolver: props.artifactResolver,
      packageName: COGNITO_ARTIFACT_PACKAGE,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment,
    });
  }
}
