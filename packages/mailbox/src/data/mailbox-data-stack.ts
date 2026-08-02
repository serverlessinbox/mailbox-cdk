import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BlobStore } from '../resources/blob-store';
import { ConfigTable } from '../resources/config-table';
import { ItemTable } from '../resources/item-table';
import { ChangelogTable } from '../resources/changelog-table';
import { AuditLogTable } from '../resources/auditlog-table';
import { MailFeedbackTable } from '../resources/mailfeedback-table';
import { MailboxKmsConfig } from '../utils/kms';
import { resolveMailboxEncryptionPlan } from '../utils/mailbox-encryption';
import { isDevelopmentMode } from '../utils/development-mode';
import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  type ServerlessInboxDeployer,
} from '../utils/serverless-inbox-tags';
import { MailboxResourceDescriptions } from '../utils/resource-descriptions';

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
 *
 * CloudFormation outputs are also published so that MailboxDataDeployer can read
 * the actual ARNs from the custom resource Data dict at deploy time.
 */
export class MailboxDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MailboxDataStackProps = {}) {
    const terminationProtection = isDevelopmentMode(scope) ? false : (props.terminationProtection ?? true);
    super(scope, id, { ...props, terminationProtection });

    this.templateOptions.description =
      'Serverless JMAP email server on AWS data tier — DynamoDB tables for configuration and email storage, plus S3 blob store.';

    // S3 name base parameter (required).
    // Allows sanitized stack name to be passed from parent stack for safe S3 bucket naming.
    const s3NameBaseParam = new cdk.CfnParameter(this, 's3NameBase', {
      type: 'String',
      description: 'S3-safe base for bucket names',
    });

    // Correlation/tagging parameters (mirror the edge stack). The originating (main) stack name and
    // the deploy metadata flow in from MailboxDataDeployer so this sub-stack's resources carry the
    // same root-stack correlation tags.
    const rootStackParam = new cdk.CfnParameter(this, 'root-stack', {
      type: 'String',
      description: 'Root (main) CloudFormation stack name (regional stack that created this data stack)',
      default: '',
    });
    rootStackParam.overrideLogicalId('rootStack');

    const productVersionParam = new cdk.CfnParameter(this, 'product-version', {
      type: 'String',
      description: 'Serverless Inbox Mailbox stack version (for tagging/support)',
      default: 'unknown',
    });
    productVersionParam.overrideLogicalId('productVersion');

    const deployerParam = new cdk.CfnParameter(this, 'deployer', {
      type: 'String',
      description: 'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
      default: 'cfn',
      allowedValues: ['cdk', 'cfn', 'marketplace'],
    });
    deployerParam.overrideLogicalId('deployer');

    // Apply product/correlation tags to everything in this data stack.
    // root-stack is the main stack name (via rootStack param); the base helper tags this
    // stack's own name as `stack` (AWS::StackName).
    applyServerlessInboxBaseTags(this, {
      product: 'mailbox',
      rootStack: rootStackParam.valueAsString,
      version: productVersionParam.valueAsString,
      deployer: deployerParam.valueAsString as unknown as ServerlessInboxDeployer,
    });
    applyServerlessInboxComponentTag(this, 'data');

    // Name tags + native descriptions for every L1 in this sub-stack. Ids aren't in the main-stack
    // component map, so supply a data-tier fallback sentence; anchor on this stack's own id.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox data tier - retained DynamoDB tables and S3 blob store.',
    }));

    // Resolve encryption settings once. For aws-managed mode this emits
    // TableEncryption.AWS_MANAGED / BucketEncryption.KMS_MANAGED without an explicit
    // encryptionKey, so CloudFormation resolves the key in the deploying account rather
    // than baking the CDK_DEFAULT_ACCOUNT placeholder (000000000000) into the KMS alias ARN.
    const encryptionPlan = resolveMailboxEncryptionPlan(this, props.kms);

    // Create resources
    const blobStore = new BlobStore(this, { encryptionKey: encryptionPlan.blobStore.encryptionKey, s3NameBase: s3NameBaseParam.valueAsString });
    const configTable = new ConfigTable(this, encryptionPlan.dynamoTables);
    const itemTable = new ItemTable(this, encryptionPlan.dynamoTables);
    const changelogTable = new ChangelogTable(this, encryptionPlan.dynamoTables);
    const auditLogTable = new AuditLogTable(this, encryptionPlan.dynamoTables);
    const mailFeedbackTable = new MailFeedbackTable(this, encryptionPlan.dynamoTables);

    // CloudFormation outputs — read by MailboxDataDeployer via custom resource Data dict.
    new cdk.CfnOutput(this, 'configTableArn',       { value: configTable.tableArn });
    new cdk.CfnOutput(this, 'itemTableArn',          { value: itemTable.tableArn });
    new cdk.CfnOutput(this, 'changelogTableArn',     { value: changelogTable.tableArn });
    new cdk.CfnOutput(this, 'auditLogTableArn',      { value: auditLogTable.tableArn });
    new cdk.CfnOutput(this, 'mailFeedbackTableArn',  { value: mailFeedbackTable.tableArn });
    new cdk.CfnOutput(this, 'blobStoreArn',          { value: blobStore.bucketArn });
  }
}
