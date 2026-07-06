import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface UserProvisionerLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  auditEventsQueue: IQueue;
  artifactResolver: ICdkArtifactResolver;
  /** Full URL of the Admin UI (e.g. https://admin.example.com). Used in welcome email CTA. */
  readonly adminUIURL: string;
  /** Blob store bucket for email attachments/bodies (used by the email service). */
  readonly blobStore: IBucket;
  /** SQS queue for email submissions (used by the submission service). */
  readonly emailSubmissionQueue: IQueue;
  /** SES configuration set name for sending emails. */
  readonly sesConfigSetName: string;
}

export class UserProvisionerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: UserProvisionerLambdaProps) {
    super(scope, id, {
      lambdaId: 'user-provisioner',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        ADMIN_UI_URL: props.adminUIURL,
        BLOB_STORAGE_NAME: props.blobStore.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
      },
    });

    // Needs to create user/account/alias/idp-mapping in config table and mailboxes in item table
    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    // Audit events emitted during provisioning
    props.auditEventsQueue.grantSendMessages(this);

    // Email service: blob store for email bodies/attachments
    props.blobStore.grantReadWrite(this);

    // Submission service: enqueue email submissions
    props.emailSubmissionQueue.grantSendMessages(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*'],
    }));

    // Direct SES v2 send for welcome email
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['ses:SendRawEmail'],
      resources: ['*'],
    }));
  }
}
