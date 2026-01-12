import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../utils/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface ApiHandlerLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  jwkCacheTable: ITable;
  emailBucket: any;
  emailSubmissionQueue: any;
  auditEventsQueue: any;
  cdnHost: string;
  apiBaseUrl: string;
  sesConfigSetName: string;
  artifactResolver: IArtifactResolver;
}

export class ApiHandlerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: ApiHandlerLambdaProps) {
    super(scope, id, {
      lambdaId: 'jmap-api',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        CDN_HOST: props.cdnHost,
        API_BASE_URL: props.apiBaseUrl,
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
      },
    });

    // Grant the Lambda function read permissions to the config table
    props.configTable.grantReadData(this);
    
    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    // Grant S3 write permissions for blob uploads
    props.emailBucket.grantReadWrite(this);

    // Grant SQS permissions to send email submission messages
    props.emailSubmissionQueue.grantSendMessages(this);

    // Grant SQS permissions to send audit events
    props.auditEventsQueue.grantSendMessages(this);
  }
}
