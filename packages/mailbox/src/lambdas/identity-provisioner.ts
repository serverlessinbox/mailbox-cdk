import type { IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }         from 'aws-cdk-lib/aws-iam';
import { PolicyStatement }         from 'aws-cdk-lib/aws-iam';
import { Duration }                from 'aws-cdk-lib';
import { Construct }               from 'constructs';

import type { IDataBlobStore }     from '../data/data-blob-store';
import type { IDataTable }         from '../data/data-tables';
import type { IEmailSendingQueue } from '../email/sending/email-sending-queue';
import type { IAuditEventsQueue }  from '../features/audit-writing/audit-events-queue';

/**
 * Narrow, provider-agnostic handle to the `identity-provisioner` Lambda: just enough for an
 * admin-api addon to invoke it and grant itself permission to do so. Never hand out the CDK
 * `IFunction` itself — this interface is the only thing an addon should receive.
 */
export interface IIdentityProvisioner {
  readonly functionArn: string;
  readonly functionName: string;
  /** Grants the given principal permission to invoke this function. Call from inside your own
   *  Lambda's constructor — never grant from outside the grantee's own construct. */
  grantInvoke(grantee: IGrantable): void;
}

export interface IdentityProvisionerLambdaProps {
  configTable: IDataTable;
  itemTable: IDataTable;
  changelogTable: IDataTable;
  auditEventsQueue: IAuditEventsQueue;
  artifactResolver: IArtifactResolver;
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

export class IdentityProvisionerLambda extends GoLambda implements IIdentityProvisioner {
  constructor(scope: Construct, id: string, props: IdentityProvisionerLambdaProps) {
    super(scope, id, {
      lambdaId: 'identity-provisioner',
      pipeline: 'admin',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        ...(props.adminUIURL ? { ADMIN_UI_URL: props.adminUIURL } : {}),
        BLOB_STORAGE_NAME: props.blobStore.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
        SYSTEM_SENDER_ADDRESS: props.systemSenderAddress,
      },
    });

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
      actions: ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }
}
