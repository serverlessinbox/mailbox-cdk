import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface UserProvisionerLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  auditEventsQueue: IQueue;
  artifactResolver: IArtifactResolver;
}

export class UserProvisionerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: UserProvisionerLambdaProps) {
    super(scope, id, {
      lambdaId: 'user-provisioner',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    // Needs to create user/account/alias/idp-mapping in config table and mailboxes in item table
    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    // Audit events emitted during provisioning
    props.auditEventsQueue.grantSendMessages(this);
  }
}
