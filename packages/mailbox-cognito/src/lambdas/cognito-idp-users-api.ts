import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../index';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IAuditEventsQueue, IIdentityProvisioner } from '@serverlessinbox/mailbox';
import type { ICognitoIdpUsersPoolConfig } from '../api/cognito-idp-users-addon';

export interface CognitoIdpUsersApiLambdaProps {
  artifactResolver: IArtifactResolver;

  /** Cognito user pool ID to manage. */
  userPoolId: string;

  /** Send-only handle to the shared audit-events queue; this Lambda grants itself send access. */
  auditEventsQueue: IAuditEventsQueue;

  /** Handle to the shared `identity-provisioner` Lambda; this Lambda grants itself invoke access. */
  identityProvisioner: IIdentityProvisioner;

  /** Cognito pool integration this Lambda grants itself admin access on. */
  pool: ICognitoIdpUsersPoolConfig;

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
 *
 * Grants itself audit-queue send access and Cognito pool admin access in its own constructor —
 * no other construct grants permissions onto this Lambda.
 */
export class CognitoIdpUsersApiLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoIdpUsersApiLambdaProps) {
    const environment: Record<string, string> = {
      USER_POOL_ID: props.userPoolId,
      AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
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

    props.pool.grantAdminAccess(this);
    props.auditEventsQueue.grantSend(this);
    props.identityProvisioner.grantInvoke(this);
  }
}
