import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { BlobStore } from '../resources/blob-store';
import { ConfigTable } from '../resources/config-table';
import { ItemTable } from '../resources/item-table';
import { ChangelogTable } from '../resources/changelog-table';
import { AuditLogTable } from '../resources/auditlog-table';
import { MailFeedbackTable } from '../resources/mailfeedback-table';
import { MailboxKmsConfig, resolveBlobStoreKey, resolveDynamoTablesKey } from '../utils/kms';
import { MailboxDataStackRef } from './mailbox-data-stack-ref';

export interface MailboxDataStackProps extends cdk.StackProps {
  readonly kms?: MailboxKmsConfig;
}

/**
 * CDK Stack that creates and owns all retained Serverless Inbox data resources:
 * - 5 DynamoDB tables (config, item, changelog, auditlog, mailfeedback)
 * - 1 S3 bucket (email storage)
 *
 * Each resource's ARN is published as an SSM parameter so that the
 * parent mailbox stack can consume them without a hard CloudFormation dependency.
 */
export class MailboxDataStack extends cdk.Stack {
  public readonly outputs: MailboxDataStackRef;

  constructor(scope: Construct, id: string, props: MailboxDataStackProps = {}) {
    super(scope, id, props);

    const ssmParam = (paramId: string, name: string, value: string): string => {
      new ssm.StringParameter(this, paramId, { parameterName: name, stringValue: value });
      return name;
    };

    // Create resources
    const blobStore = new BlobStore(this, { encryptionKey: resolveBlobStoreKey(this, props.kms) });
    const configTable = new ConfigTable(this, { encryptionKey: resolveDynamoTablesKey(this, props.kms) });
    const itemTable = new ItemTable(this, { encryptionKey: resolveDynamoTablesKey(this, props.kms) });
    const changelogTable = new ChangelogTable(this, { encryptionKey: resolveDynamoTablesKey(this, props.kms) });
    const auditLogTable = new AuditLogTable(this, { encryptionKey: resolveDynamoTablesKey(this, props.kms) });
    const mailFeedbackTable = new MailFeedbackTable(this, { encryptionKey: resolveDynamoTablesKey(this, props.kms) });

    // Publish SSM parameters (ARN only) and collect paths
    const configTableArnParam = ssmParam('config-table-arn-param', `/${this.stackName}/config-table-arn`, configTable.tableArn);
    const itemTableArnParam = ssmParam('item-table-arn-param', `/${this.stackName}/item-table-arn`, itemTable.tableArn);
    const changelogTableArnParam = ssmParam('changelog-table-arn-param', `/${this.stackName}/changelog-table-arn`, changelogTable.tableArn);
    const auditLogTableArnParam = ssmParam('auditlog-table-arn-param', `/${this.stackName}/auditlog-table-arn`, auditLogTable.tableArn);
    const mailFeedbackTableArnParam = ssmParam('mailfeedback-table-arn-param', `/${this.stackName}/mailfeedback-table-arn`, mailFeedbackTable.tableArn);
    const blobStoreArnParam = ssmParam('blob-store-arn-param', `/${this.stackName}/blob-store-arn`, blobStore.bucketArn);

    this.outputs = {
      configTableArnParam,
      itemTableArnParam,
      changelogTableArnParam,
      auditLogTableArnParam,
      mailFeedbackTableArnParam,
      blobStoreArnParam,
    };
  }
}
