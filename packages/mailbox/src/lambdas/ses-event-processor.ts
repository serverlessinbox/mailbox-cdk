import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../utils/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface SESEventProcessorLambdaProps {
  itemTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  configTable: ITable;
  emailBucket: IBucket;
  auditEventsQueue: IQueue;
  artifactResolver: IArtifactResolver;
}

export class SESEventProcessorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SESEventProcessorLambdaProps) {
    super(scope, id, {
      lambdaId: 'sqs-ses-event-processor',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        MAIL_FEEDBACK_TABLE_NAME: props.mailFeedbackTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    // Grant permissions
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    props.mailFeedbackTable.grantReadWriteData(this);
    props.configTable.grantReadWriteData(this);
    props.emailBucket.grantReadWrite(this);
    props.auditEventsQueue.grantSendMessages(this);
  }
}
