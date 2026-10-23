import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                             from '@serverlessinbox/mailbox-cdk-shared';
import type { Pipeline }                        from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                             from 'aws-cdk-lib';
import { Construct }                            from 'constructs';
import type { IDependable }                     from 'constructs';

import type { AuthPolicyName, OAuthClientName } from '../../contracts/auth-names';
import type { IAuditEventsQueue }               from '../queues/audit-events-queue';
import type { IDataTable }                      from '../tables/data-tables';

/**
 * The config table and audit queue the exchange uses, and the auth policy and OAuth client it is bound
 * to. The caller creates the tables and queue and chooses the policy and client.
 */
export interface IdpTokenExchangeLambdaProps {
  readonly configTable:      IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly authPolicyName:   AuthPolicyName;
  readonly oauthClientName:  OAuthClientName;
  readonly artifactResolver: IArtifactResolver;

  /** SERVICE_NAME for this physical function; distinguishes it from other IdpTokenExchangeLambda instances sharing the 'idp-token-exchange' lambdaId. */
  readonly serviceName: string;

  /** This one code site is instantiated for both webmail-ui ('jmap') and admin-ui ('admin'); the caller states which. */
  readonly pipeline: Pipeline;

  /** Resources that must be deployed before this function is created or updated. */
  readonly dependsOn?: IDependable[];
}

/**
 * The Go Lambda that performs the identity-provider token exchange for the auth policy and OAuth
 * client it is given. It does not own the config table or the audit queue.
 */
export class IdpTokenExchangeLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: IdpTokenExchangeLambdaProps) {
    super(scope, id, {
      lambdaId:         'idp-token-exchange',
      pipeline:         props.pipeline,
      serviceName:      props.serviceName,
      artifactResolver: props.artifactResolver,
      memorySize:       256,
      timeout:          Duration.seconds(30),
      environment:      {
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        AUTH_POLICY_NAME:       props.authPolicyName,
        OAUTH_CLIENT_NAME:      props.oauthClientName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    props.configTable.grantRead(this);
    props.auditEventsQueue.grantSend(this);

    this.node.addDependency(...(props.dependsOn ?? []));
  }
}
