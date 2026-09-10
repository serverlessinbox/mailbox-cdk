import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../api/websocket';
import { resolveVendorAccountIds } from '../addons/support-roles-infra';

export interface AdminApiLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  auditLogTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  blobStore: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;
  artifactResolver: ICdkArtifactEngine;
  identityProvisionerFunction: IFunction;
  /** Name of the SES receipt rule set. Required for setup-flow SES readiness checks. */
  sesRuleSetName: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
  /** System sender email address (e.g. noreply@example.com). Used for sending system emails. */
  readonly systemSenderAddress: string;
}

export class AdminApiLambda extends GoLambda implements IWebSocketPushTarget {
  private grantStatusAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "lambda:GetAccountSettings",
        "sts:GetCallerIdentity",
      ],
      resources: ["*"],
    }));
  }

  private grantSesAccess(sesConfigSetName: string) {
    // Identity-bound actions scoped to the identity ARN pattern.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityDkimSigningAttributes",
      ],
      resources: [`arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/*`],
    }));
    // SendEmail authorizes against the configuration-set resource as well as the identity
    // resource (it does not bind only to `identity`), so both ARNs must be granted.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["ses:SendEmail"],
      resources: [
        `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/*`,
        `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:configuration-set/${sesConfigSetName}`,
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
    // Route53 exposes no condition keys on any resource type, and hosted zones are
    // customer-arbitrary at runtime — no ARN/tag scoping is possible here.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "route53:ChangeResourceRecordSets",
        "route53:ListHostedZonesByName",
        "route53:ListResourceRecordSets",
      ],
      resources: ["*"],
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

  private grantLicenseApiAccess() {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["execute-api:Invoke"],
      resources: resolveVendorAccountIds().flatMap((accountId) => [
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
        IDENTITY_PROVISIONER_FUNCTION_NAME: props.identityProvisionerFunction.functionName,
        SYSTEM_SENDER_ADDRESS: props.systemSenderAddress,
        STACK_IDENTITY_TAG_VALUE: Stack.of(scope).stackName,
      },
    });

    // Grant permissions BEFORE the Lambda is used by API Gateway
    this.grantStatusAccess();
    this.grantSesAccess(props.sesConfigSetName);
    this.grantRoute53Access();
    this.grantServiceQuotasAccess();
    this.grantLicenseApiAccess();

    this.addEnvironment('SES_RULE_SET_NAME', props.sesRuleSetName);
    this.grantSesReceivingAccess();

    props.auditLogTable.grantReadData(this);
    props.mailFeedbackTable.grantReadData(this);

    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    props.auditEventsQueue.grantSendMessages(this);

    // Needed for standard JMAP email storage + submission enqueue
    props.blobStore.grantReadWrite(this);
    props.emailSubmissionQueue.grantSendMessages(this);

    // Grant the User provisioning function to be invoked
    props.identityProvisionerFunction.grantInvoke(this);
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
