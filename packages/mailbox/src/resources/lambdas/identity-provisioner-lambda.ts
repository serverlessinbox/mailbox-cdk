import type { IArtifactResolver }              from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, GoLambda }      from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                     from 'aws-cdk-lib/aws-iam';
import { PolicyStatement }                     from 'aws-cdk-lib/aws-iam';
import { Aws, Duration }                       from 'aws-cdk-lib';
import { Construct }                           from 'constructs';

import type { IDataBlobStore }                 from '../buckets/data-blob-store';
import type { IAuditEventsQueue }              from '../queues/audit-events-queue';
import type { IEmailSendingQueue }             from '../queues/email-sending-queue';
import type { IDataTable }                     from '../tables/data-tables';

/**
 * Narrow, provider-agnostic handle to the `identity-provisioner` Lambda: just enough for an
 * admin-api addon to invoke it and grant itself permission to do so. Never hand out the CDK
 * `IFunction` itself — this interface is the only thing an addon should receive.
 */
export interface IIdentityProvisioner {
  readonly functionArn:  string;
  readonly functionName: string;
  /** Grants the given principal permission to invoke this function. Call from inside your own
   *  Lambda's constructor — never grant from outside the grantee's own construct. */
  grantInvoke(grantee: IGrantable): void;
}

/**
 * The tables, queues, blob store and SES settings the provisioner uses to create a mailbox user. The
 * caller creates every resource here; this Lambda only writes to them.
 */
export interface IdentityProvisionerLambdaProps {
  readonly configTable:      IDataTable;
  readonly itemTable:        IDataTable;
  readonly changelogTable:   IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;
  /** Full URL of the Admin UI (e.g. https://admin.example.com). Used in welcome email CTA. Absent when no Admin UI is deployed. */
  readonly adminUIURL?: string;
  /** Blob store bucket for email attachments/bodies (used by the email service). */
  readonly blobStore: IDataBlobStore;
  /** SQS queue for email submissions (used by the submission service). */
  readonly emailSubmissionQueue: IEmailSendingQueue;
  /** SES configuration set name for sending emails. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/**
 * The Lambda that provisions mailbox users. It is invoked through {@link IIdentityProvisioner}, so
 * callers never receive the function itself.
 */
export class IdentityProvisionerLambda extends GoLambda implements IIdentityProvisioner {
  constructor(scope: Construct, id: string, props: IdentityProvisionerLambdaProps) {
    super(scope, id, {
      lambdaId:         'identity-provisioner',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      memorySize:       640,
      timeout:          Duration.seconds(30),
      environment:      {
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        ITEM_TABLE_NAME:        props.itemTable.tableName,
        CHANGELOG_TABLE_NAME:   props.changelogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        ...(props.adminUIURL ? { ADMIN_UI_URL: props.adminUIURL } : {}),
        BLOB_STORAGE_NAME:          props.blobStore.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        SES_CONFIG_SET_NAME:        props.sesConfigSetName,
        SYSTEM_SENDER_ADDRESS:      props.systemSenderAddress,
      },
    });
    ComponentDescription.describe(this, 'Provisions new mailbox users — creates their mailbox structure and initial state.');

    // Needs to create user/account/alias/idp-mapping in config table and mailboxes in item table
    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    // Audit events emitted during provisioning
    props.auditEventsQueue.grantSend(this);

    // Email service: blob store for email bodies/attachments
    props.blobStore.grantEmailBlobWrite(this);

    // Submission service: enqueue email submissions
    props.emailSubmissionQueue.grantSend(this);

    this.grantLicenseApiAccess(props.vendorAccountIds);
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]) {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions:   ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }
}
