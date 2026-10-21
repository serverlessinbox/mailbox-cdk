import type { IArtifactResolver }                                                         from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda, ServerlessInboxTagKeys, StackIdentity, rootStackRequestTagConditions } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }                                                                 from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement, Effect }                                                        from 'aws-cdk-lib/aws-iam';
import { Aws, Duration, Stack }                                                           from 'aws-cdk-lib';
import { Construct }                                                                      from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget }                        from '../../api/websocket/websocket';
import type { IDataBlobStore }                                                            from '../buckets/data-blob-store';
import type { IDataTable }                                                                from '../tables/data-tables';
import type { IEmailSendingQueue }                                                        from '../queues/email-sending-queue';
import type { IAuditEventsQueue }                                                         from '../queues/audit-events-queue';

import type { IIdentityProvisioner }                                                      from './identity-provisioner-lambda';

export interface AdminApiLambdaProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly auditLogTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly blobStore: IDataBlobStore;
  readonly emailSubmissionQueue: IEmailSendingQueue;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;
  readonly identityProvisioner: IIdentityProvisioner;
  /** Name of the SES receipt rule set. */
  readonly sesRuleSetName: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
  /** AWS account IDs hosting the vendor service API. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key identifying this stack's resources. Set as STACK_IDENTITY_TAG_KEY and used in the ses:TagResource condition. */
  readonly stackIdentityTagKey: string;
}

/**
 * The admin-api Lambda and its role. The role holds every grant the admin API needs, as named
 * grant methods. The websocket push variable is not part of construction; `enableWebSocketPush`
 * sets it together with its invoke grant.
 */
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
        ROOT_STACK_ID: StackIdentity.guid,
        SES_RULE_SET_NAME: props.sesRuleSetName,
      },
    });

    this.grantStatusAccess();
    this.grantSesIdentityManagement();
    this.grantSesIdentityStackTagging(props.stackIdentityTagKey);
    this.grantSesSending(props.sesConfigSetName);
    this.grantSesAccountReads();
    this.grantDkimAndDmarcRecordWrites();
    this.grantApexRecordWrites();
    this.grantHostedZoneRecordListing();
    this.grantHostedZoneLookup();
    this.denyAcmeChallengeRecordWrites();
    this.grantServiceQuotasAccess();
    this.grantLicenseApiAccess(props.vendorAccountIds);
    this.grantSesReceivingAccess();

    props.auditLogTable.grantRead(this);
    props.mailFeedbackTable.grantRead(this);

    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    props.auditEventsQueue.grantSend(this);

    props.blobStore.grantEmailBlobWrite(this);
    props.emailSubmissionQueue.grantSend(this);

    props.identityProvisioner.grantInvoke(this);
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }

  private grantStatusAccess(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['lambda:GetAccountSettings', 'sts:GetCallerIdentity'],
      resources: ['*'],
    }));
  }

  private grantSesIdentityManagement(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'ses:CreateEmailIdentity',
        'ses:GetEmailIdentity',
        'ses:DeleteEmailIdentity',
        'ses:PutEmailIdentityDkimSigningAttributes',
      ],
      resources: [`arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`],
    }));
  }

  private grantSesIdentityStackTagging(stackIdentityTagKey: string): void {
    // CreateEmailIdentity is called with a Tags parameter (the Go provisioner stamps the
    // stack-identity tag on create), which AWS co-authorizes against ses:TagResource. The
    // identity doesn't exist yet at that point, so aws:ResourceTag can't gate this — it would
    // always deny. Gate on aws:RequestTag (the tag being written) instead, and constrain
    // aws:TagKeys so this role can't ride along to write an unrelated tag key.
    const rootStack: RootStack = { name: Stack.of(this).stackName, id: StackIdentity.guid };
    for (const conditions of rootStackRequestTagConditions(rootStack)) {
      this.addToRolePolicy(new PolicyStatement({
        actions: ['ses:TagResource'],
        resources: [`arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`],
        conditions: {
          ...conditions,
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [stackIdentityTagKey, ServerlessInboxTagKeys.rootStackId],
          },
        },
      }));
    }
  }

  private grantSesSending(sesConfigSetName: string): void {
    // SendEmail authorizes against the configuration-set resource as well as the identity
    // resource (it does not bind only to `identity`), so both ARNs must be granted.
    this.addToRolePolicy(new PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`,
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:configuration-set/${sesConfigSetName}`,
      ],
    }));
  }

  /** Account-level actions have no resource binding, so they stay on `*`. */
  private grantSesAccountReads(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['ses:GetAccount', 'ses:GetSendStatistics', 'ses:ListEmailIdentities'],
      resources: ['*'],
    }));
  }

  /**
   * Scoping on the Route53 record grants is enforced entirely by condition keys; the
   * hostedzone/* resource ARN is semantically equivalent to * for this action.
   */
  private grantDkimAndDmarcRecordWrites(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['route53:ChangeResourceRecordSets'],
      resources: ['arn:aws:route53:::hostedzone/*'],
      conditions: {
        'ForAllValues:StringLike': {
          'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['*._domainkey.*', '_dmarc.*'],
        },
        'ForAllValues:StringEquals': {
          'route53:ChangeResourceRecordSetsRecordTypes': ['CNAME', 'TXT'],
          'route53:ChangeResourceRecordSetsActions': ['UPSERT', 'DELETE'],
        },
        Null: {
          'route53:ChangeResourceRecordSetsNormalizedRecordNames': false,
          'route53:ChangeResourceRecordSetsRecordTypes': false,
          'route53:ChangeResourceRecordSetsActions': false,
        },
      },
    }));
  }

  /**
   * Constrains record type and action but deliberately not record name: domains are added after
   * bootstrap, so the set of zones and apex names is open, and a name condition would break
   * multi-domain support.
   */
  private grantApexRecordWrites(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['route53:ChangeResourceRecordSets'],
      resources: ['arn:aws:route53:::hostedzone/*'],
      conditions: {
        'ForAllValues:StringEquals': {
          'route53:ChangeResourceRecordSetsRecordTypes': ['MX', 'TXT'],
          'route53:ChangeResourceRecordSetsActions': ['UPSERT', 'DELETE'],
        },
        Null: {
          'route53:ChangeResourceRecordSetsRecordTypes': false,
          'route53:ChangeResourceRecordSetsActions': false,
        },
      },
    }));
  }

  private grantHostedZoneRecordListing(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['route53:ListResourceRecordSets'],
      resources: ['arn:aws:route53:::hostedzone/*'],
    }));
  }

  /** Listing hosted zones has no resource ARN binding. */
  private grantHostedZoneLookup(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['route53:ListHostedZonesByName'],
      resources: ['*'],
    }));
  }

  /** Prevents certificate issuance for arbitrary domains by denying ACME challenge writes in every zone. */
  private denyAcmeChallengeRecordWrites(): void {
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.DENY,
      actions: ['route53:ChangeResourceRecordSets'],
      resources: ['*'],
      conditions: {
        'ForAnyValue:StringLike': {
          'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['_acme-challenge.*'],
        },
      },
    }));
  }

  /** Account-level actions have no resource binding, so they stay on `*`. */
  private grantServiceQuotasAccess(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['servicequotas:ListServiceQuotas', 'servicequotas:RequestServiceQuotaIncrease'],
      resources: ['*'],
    }));
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]): void {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.addToRolePolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }

  /** Account-level action with no resource binding, so it stays on `*`. */
  private grantSesReceivingAccess(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['ses:DescribeActiveReceiptRuleSet'],
      resources: ['*'],
    }));
  }
}
