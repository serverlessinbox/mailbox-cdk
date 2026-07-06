import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import { AuthPolicyName, OAuthClientName } from '../auth/types';

export interface IdpTokenExchangeLambdaProps {
  configTable: ITable;
  auditEventsQueue?: IQueue;
  authPolicyName?: AuthPolicyName;
  oauthClientName?: OAuthClientName;
  artifactResolver: ICdkArtifactResolver;
}

export class IdpTokenExchangeLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: IdpTokenExchangeLambdaProps) {
    super(scope, id, {
      lambdaId: 'idp-token-exchange',
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUTH_POLICY_NAME: props.authPolicyName ?? 'ADMIN_API',
        OAUTH_CLIENT_NAME: props.oauthClientName ?? 'ADMIN_UI',
        ...(props.auditEventsQueue ? { AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl } : {}),
      },
    });

    props.configTable.grantReadData(this);

    if (props.auditEventsQueue) {
      props.auditEventsQueue.grantSendMessages(this);
    }
  }
}
