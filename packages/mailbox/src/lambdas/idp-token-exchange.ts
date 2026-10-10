import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Construct } from 'constructs';
import type { IDataTable } from '../data/data-tables';
import { Duration } from 'aws-cdk-lib';
import { AuthPolicyName, OAuthClientName } from '../auth/types';
import type { Pipeline } from '@serverlessinbox/mailbox-cdk-shared';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';

export interface IdpTokenExchangeLambdaProps {
  configTable: IDataTable;
  auditEventsQueue: IAuditEventsQueue;
  authPolicyName?: AuthPolicyName;
  oauthClientName?: OAuthClientName;
  artifactResolver: IArtifactResolver;

  /** SERVICE_NAME for this physical function; distinguishes it from other IdpTokenExchangeLambda instances sharing the 'idp-token-exchange' lambdaId. */
  serviceName: string;

  /** This one code site is instantiated for both webmail-ui ('jmap') and admin-ui ('admin'); the caller states which. */
  readonly pipeline: Pipeline;
}

export class IdpTokenExchangeLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: IdpTokenExchangeLambdaProps) {
    super(scope, id, {
      lambdaId: 'idp-token-exchange',
      pipeline: props.pipeline,
      serviceName: props.serviceName,
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUTH_POLICY_NAME: props.authPolicyName ?? 'ADMIN_API',
        OAUTH_CLIENT_NAME: props.oauthClientName ?? 'ADMIN_UI',
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    props.configTable.grantRead(this);
    props.auditEventsQueue.grantSend(this);
  }
}
