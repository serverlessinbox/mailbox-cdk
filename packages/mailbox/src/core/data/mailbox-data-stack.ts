import { isDevelopmentMode, removalPolicyForRetainedResources }                           from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxBaseTagsWithDeployerType, applyServerlessInboxComponentTag } from '@serverlessinbox/mailbox-cdk-shared';
import type { ServerlessInboxDeployerType }                                               from '@serverlessinbox/mailbox-cdk-shared';
import * as cdk                                                                           from 'aws-cdk-lib';
import { Construct }                                                                      from 'constructs';

import { BlobStore }                                                                      from '../../resources/buckets/blob-store';
import { AuditLogTable }                                                                  from '../../resources/tables/auditlog-table';
import { ChangelogTable }                                                                 from '../../resources/tables/changelog-table';
import { ConfigTable }                                                                    from '../../resources/tables/config-table';
import { ItemTable }                                                                      from '../../resources/tables/item-table';
import { MailFeedbackTable }                                                              from '../../resources/tables/mailfeedback-table';
import { defaultCfnResource }                                                             from '../../utils/cfn-resource';
import { MailboxResourceDescriptions }                                                    from '../../utils/resource-descriptions';
import type { MailboxKmsConfig }                                                          from '../kms';
import { MailboxEncryption }                                                              from '../mailbox-encryption';

/** The values the data stack's template parameters take; the keys are the parameter names. */
export type MailboxDataStackParameters = {
  /** S3-safe base for bucket names. */
  readonly nameBase:     string;
  /** Root (main) CloudFormation stack name. */
  readonly rootStack:    string;
  /** Unique id (stack id guid) of the root (main) CloudFormation stack. */
  readonly rootStackId:  string;
  /** Deployment mechanism label used for tagging. */
  readonly deployerType: ServerlessInboxDeployerType;
};

/** Props of {@link MailboxDataStack}. */
export interface MailboxDataStackProps extends cdk.StackProps {
  readonly kms?: MailboxKmsConfig;
}

/**
 * CDK Stack that creates and owns all retained Serverless Inbox data resources: the DynamoDB tables
 * (config, item, changelog, auditlog, mailfeedback) and the S3 bucket for email storage.
 *
 * The ARN of each resource is a CloudFormation output. The parameters are {@link MailboxDataStackParameters}.
 */
export class MailboxDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MailboxDataStackProps = {}) {
    const terminationProtection = isDevelopmentMode(scope) ? false : (props.terminationProtection ?? true);
    super(scope, id, { ...props, terminationProtection });

    this.templateOptions.description =
      'Serverless JMAP email server on AWS data tier — DynamoDB tables for configuration and email storage, plus S3 blob store.';

    const nameBaseParam = this.declareParameter('nameBase', {
      type:        'String',
      description: 'S3-safe base for bucket names',
    });

    const rootStackParam = this.declareParameter('rootStack', {
      type:        'String',
      description: 'Root (main) CloudFormation stack name (regional stack that created this data stack)',
      default:     '',
    });

    const rootStackIdParam = this.declareParameter('rootStackId', {
      type:        'String',
      description: 'Unique id (stack id guid) of the root (main) CloudFormation stack',
    });

    const deployerTypeParam = this.declareParameter('deployerType', {
      type:          'String',
      description:   'Deployment mechanism label (cdk|cfn|marketplace) used for tagging',
      default:       'cfn',
      allowedValues: ['cdk', 'cfn', 'marketplace'],
    });

    applyServerlessInboxBaseTagsWithDeployerType(
      this,
      { rootStack: rootStackParam.valueAsString },
      deployerTypeParam.valueAsString as ServerlessInboxDeployerType,
      rootStackIdParam.valueAsString,
    );
    applyServerlessInboxComponentTag(this, 'data');

    // The ids of the data tier are not in the main stack's component map, so this fallback names them.
    cdk.Aspects.of(this).add(new MailboxResourceDescriptions(this.node.id, {
      fallbackDescription: 'ServerlessInbox data tier - retained DynamoDB tables and S3 blob store.',
    }));

    const encryptionPlan   = MailboxEncryption.plan(props.kms);
    const dynamoEncryption = encryptionPlan.dynamoTables;
    const developmentMode  = isDevelopmentMode(this);
    const dynamoTableProps = {
      nameBase:                   nameBaseParam.valueAsString,
      encryption:                 dynamoEncryption.encryption,
      pointInTimeRecoveryEnabled: !developmentMode,
      ...(dynamoEncryption.encryptionKey && { encryptionKey: dynamoEncryption.encryptionKey }),
    };

    const blobStore         = new BlobStore(this, {
      encryptionKey: encryptionPlan.blobStore.encryptionKey,
      nameBase:      nameBaseParam.valueAsString,
      removalPolicy: removalPolicyForRetainedResources(this),
      developmentMode,
    });
    const configTable       = new ConfigTable(this, dynamoTableProps);
    const itemTable         = new ItemTable(this, dynamoTableProps);
    const changelogTable    = new ChangelogTable(this, dynamoTableProps);
    const auditLogTable     = new AuditLogTable(this, dynamoTableProps);
    const mailFeedbackTable = new MailFeedbackTable(this, dynamoTableProps);

    defaultCfnResource(configTable).overrideLogicalId('configTable');
    defaultCfnResource(itemTable).overrideLogicalId('itemTable');
    defaultCfnResource(changelogTable).overrideLogicalId('changelogTable');
    defaultCfnResource(auditLogTable).overrideLogicalId('auditLogTable');
    defaultCfnResource(mailFeedbackTable).overrideLogicalId('mailFeedbackTable');
    defaultCfnResource(blobStore).overrideLogicalId('blobStore');
    if (!blobStore.policy) {
      throw new Error(
        'BlobStore must have a resource policy (addToResourcePolicy called during construction). ' +
        'If this error occurs, verify BlobStore initializes its policy correctly.',
      );
    }
    defaultCfnResource(blobStore.policy).overrideLogicalId('blobStorePolicy');

    new cdk.CfnOutput(this, 'configTableArn',       { value: configTable.tableArn });
    new cdk.CfnOutput(this, 'itemTableArn',          { value: itemTable.tableArn });
    new cdk.CfnOutput(this, 'changelogTableArn',     { value: changelogTable.tableArn });
    new cdk.CfnOutput(this, 'auditLogTableArn',      { value: auditLogTable.tableArn });
    new cdk.CfnOutput(this, 'mailFeedbackTableArn',  { value: mailFeedbackTable.tableArn });
    new cdk.CfnOutput(this, 'blobStoreArn',          { value: blobStore.bucketArn });
  }

  /** Declares the parameter `name` under that name, which is also its logical id in the template. */
  private declareParameter(name: keyof MailboxDataStackParameters, props: cdk.CfnParameterProps): cdk.CfnParameter {
    const parameter = new cdk.CfnParameter(this, name, props);
    parameter.overrideLogicalId(name);
    return parameter;
  }
}
