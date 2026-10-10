import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IDataTable } from '../data/data-tables';
import type { IDataBlobStore } from '../data/data-blob-store';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../api/websocket/websocket';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';
import type { IEmailSendingQueue } from '../email/sending/email-sending-queue';
import type { IIdentityProvisioner } from './identity-provisioner';

export interface AdminApiLambdaProps {
  configTable: IDataTable;
  itemTable: IDataTable;
  auditLogTable: IDataTable;
  changelogTable: IDataTable;
  mailFeedbackTable: IDataTable;
  blobStore: IDataBlobStore;
  emailSubmissionQueue: IEmailSendingQueue;
  auditEventsQueue: IAuditEventsQueue;
  artifactResolver: IArtifactResolver;
  identityProvisioner: IIdentityProvisioner;
  /** Name of the SES receipt rule set. Required for setup-flow SES readiness checks. */
  sesRuleSetName: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key used to identify resources belonging to this stack, sourced from the tag-key registry. */
  readonly stackIdentityTagKey: string;
}

export class AdminApiLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: AdminApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'admin-api',
      pipeline: 'admin',
      artifactResolver: props.artifactResolver,
      memorySize: 640,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        MAIL_FEEDBACK_TABLE_NAME: props.mailFeedbackTable.tableName,
        BLOB_STORE_NAME: props.blobStore.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisioner.functionName,
        SYSTEM_SENDER_ADDRESS: props.systemSenderAddress,
        STACK_IDENTITY_TAG_VALUE: Stack.of(scope).stackName,
        STACK_IDENTITY_TAG_KEY: props.stackIdentityTagKey,
      },
    });

    // Grant permissions BEFORE the Lambda is used by API Gateway
    this.grantStatusAccess();
    this.grantSesAccess(props.sesConfigSetName, props.stackIdentityTagKey);
    this.grantRoute53Access();
    this.grantServiceQuotasAccess();
    this.grantLicenseApiAccess(props.vendorAccountIds);

    this.addEnvironment('SES_RULE_SET_NAME', props.sesRuleSetName);
    this.grantSesReceivingAccess();

    props.auditLogTable.grantRead(this);
    props.mailFeedbackTable.grantRead(this);

    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    props.auditEventsQueue.grantSend(this);

    // Needed for standard JMAP email storage + submission enqueue
    props.blobStore.grantEmailBlobWrite(this);
    props.emailSubmissionQueue.grantSend(this);

    // Grant the User provisioning function to be invoked
    props.identityProvisioner.grantInvoke(this);
  }

  private grantStatusAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "lambda:GetAccountSettings",
        "sts:GetCallerIdentity",
      ],
      resources: ["*"],
    }));
  }

  private grantSesAccess(sesConfigSetName: string, stackIdentityTagKey: string) {
    // Identity-bound actions scoped to the identity ARN pattern.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityDkimSigningAttributes",
      ],
      resources: [`arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`],
    }));
    // CreateEmailIdentity is called with a Tags parameter (the Go provisioner stamps the
    // stack-identity tag on create), which AWS co-authorizes against ses:TagResource. The
    // identity doesn't exist yet at that point, so aws:ResourceTag can't gate this — it would
    // always deny. Gate on aws:RequestTag (the tag being written) instead, and constrain
    // aws:TagKeys so this role can't ride along to write an unrelated tag key.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["ses:TagResource"],
      resources: [`arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`],
      conditions: {
        StringEquals: {
          [`aws:RequestTag/${stackIdentityTagKey}`]: Stack.of(this).stackName,
        },
        'ForAllValues:StringEquals': {
          'aws:TagKeys': [stackIdentityTagKey],
        },
      },
    }));
    // SendEmail authorizes against the configuration-set resource as well as the identity
    // resource (it does not bind only to `identity`), so both ARNs must be granted.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["ses:SendEmail"],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`,
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:configuration-set/${sesConfigSetName}`,
      ],
    }));
    // Account-level actions — no resource binding, stay '*'.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "ses:GetAccount",
        "ses:GetSendStatistics",
        "ses:ListEmailIdentities",
      ],
      resources: ["*"],
    }));
  }

  private grantRoute53Access() {
    // Scoping is enforced entirely by condition keys; the hostedzone/* resource ARN is
    // semantically equivalent to * for this action.
    //
    // The apex statement constrains record type and action but deliberately not record name.
    // Domains are added after bootstrap, so the set of zones and apex names is open; adding a
    // name condition there would break multi-domain support.

    // Underscore-prefixed records: DKIM and DMARC
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["route53:ChangeResourceRecordSets"],
      resources: ["arn:aws:route53:::hostedzone/*"],
      conditions: {
        "ForAllValues:StringLike": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["*._domainkey.*", "_dmarc.*"],
        },
        "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsRecordTypes": ["CNAME", "TXT"],
          "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
        },
        "Null": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": false,
          "route53:ChangeResourceRecordSetsRecordTypes": false,
          "route53:ChangeResourceRecordSetsActions": false,
        },
      },
    }));

    // Apex records: MX and SPF (no name prefix condition, as the apex is the customer's domain)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["route53:ChangeResourceRecordSets"],
      resources: ["arn:aws:route53:::hostedzone/*"],
      conditions: {
        "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsRecordTypes": ["MX", "TXT"],
          "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"],
        },
        "Null": {
          "route53:ChangeResourceRecordSetsRecordTypes": false,
          "route53:ChangeResourceRecordSetsActions": false,
        },
      },
    }));

    // Read-only access: listing records
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["route53:ListResourceRecordSets"],
      resources: ["arn:aws:route53:::hostedzone/*"],
    }));

    // Account-level read: listing hosted zones (no resource ARN binding available)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["route53:ListHostedZonesByName"],
      resources: ["*"],
    }));

    // Deny ACME challenge writes across all zones (prevents certificate issuance for arbitrary domains)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.DENY,
      actions: ["route53:ChangeResourceRecordSets"],
      resources: ["*"],
      conditions: {
        "ForAnyValue:StringLike": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["_acme-challenge.*"],
        },
      },
    }));
  }

  private grantServiceQuotasAccess() {
    // Account-level actions — no resource binding, stay '*'.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "servicequotas:ListServiceQuotas",
        "servicequotas:RequestServiceQuotaIncrease",
      ],
      resources: ["*"],
    }));
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]) {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["execute-api:Invoke"],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }

  private grantSesReceivingAccess() {
    // Account-level action — no resource binding, stays '*'.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["ses:DescribeActiveReceiptRuleSet"],
      resources: ["*"],
    }));
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
