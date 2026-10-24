import type { IArtifactResolver }                       from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }                             from '@serverlessinbox/mailbox-cdk-shared';
import type { IAuditEventsQueue, IIdentityProvisioner } from '@serverlessinbox/mailbox';
import { Duration }                                     from 'aws-cdk-lib';
import { Construct }                                    from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE }                     from '../../cognito-artifact-package';
import type { ICognitoIdpUsersPoolConfig }              from '../../cognito-idp-users-pool-config';

/** What `CognitoIdpUsersApiLambda` needs to resolve its code and to reach the pool, queue and Lambda it works with. */
export interface CognitoIdpUsersApiLambdaProps {
  readonly artifactResolver: IArtifactResolver;

  /** Send-only handle to the shared audit-events queue; this Lambda grants itself send access. */
  readonly auditEventsQueue: IAuditEventsQueue;

  /** Handle to the shared `identity-provisioner` Lambda; this Lambda grants itself invoke access. */
  readonly identityProvisioner: IIdentityProvisioner;

  /** Cognito pool whose users this Lambda manages; the Lambda grants itself admin access on it. */
  readonly pool: ICognitoIdpUsersPoolConfig;

  /** The names of the groups whose members are admins. Left out when the user pool defines none. */
  readonly adminGroups?: string[];

  /** The names of the groups whose members are users. Left out when the user pool defines none. */
  readonly userGroups?: string[];
}

/** The Lambda that serves the Cognito user management endpoints of the admin API. */
export class CognitoIdpUsersApiLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoIdpUsersApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'cognito-idp-users-api',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      packageName:      COGNITO_ARTIFACT_PACKAGE,
      timeout:          Duration.seconds(15),
      memorySize:       256,
      environment:      {
        USER_POOL_ID:                       props.pool.userPool.userPoolId,
        AUDIT_EVENTS_QUEUE_URL:             props.auditEventsQueue.queueUrl,
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
        ...(props.adminGroups === undefined ? {} : { ADMIN_GROUPS: JSON.stringify(props.adminGroups) }),
        ...(props.userGroups === undefined ? {} : { USER_GROUPS: JSON.stringify(props.userGroups) }),
      },
    });

    props.pool.grantAdminAccess(this);
    props.auditEventsQueue.grantSend(this);
    props.identityProvisioner.grantInvoke(this);
  }
}
