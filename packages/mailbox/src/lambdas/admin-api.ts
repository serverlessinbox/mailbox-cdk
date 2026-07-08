import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

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
  userProvisionerFunction: IFunction;
  /** Name of the SES receipt rule set. Required for setup-flow SES readiness checks. */
  sesRuleSetName?: string;
  /** SES configuration set name for outbound email tracking. */
  readonly sesConfigSetName: string;
}

export class AdminApiLambda extends GoLambda {
  private grantStatusAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "lambda:GetAccountSettings",
        "sts:GetCallerIdentity",
      ],
      resources: ["*"],
    }));
  }

  private grantSesAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "ses:GetAccount",
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:GetSendStatistics",
        "ses:ListEmailIdentities",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityDkimSigningAttributes",
        "ses:SendEmail",
      ],
      resources: ["*"],
    }));
  }

  private grantRoute53Access() {
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
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        "servicequotas:ListServiceQuotas",
        "servicequotas:RequestServiceQuotaIncrease",
      ],
      resources: ["*"],
    }));
  }

  private grantLicenseApiAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["execute-api:Invoke"],
      resources: ["*"],
    }));
  }

  private grantSesReceivingAccess() {
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ["ses:DescribeActiveReceiptRuleSet"],
      resources: ["*"],
    }));
  }

  constructor(scope: Construct, id: string, props: AdminApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'admin-api',
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
        USER_PROVISIONER_FUNCTION_NAME: props.userProvisionerFunction.functionName,
      },
    });

    // Grant permissions BEFORE the Lambda is used by API Gateway
    this.grantStatusAccess();
    this.grantSesAccess();
    this.grantRoute53Access();
    this.grantServiceQuotasAccess();
    this.grantLicenseApiAccess();

    if (props.sesRuleSetName) {
      this.addEnvironment('SES_RULE_SET_NAME', props.sesRuleSetName);
      this.grantSesReceivingAccess();
    }

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
    props.userProvisionerFunction.grantInvoke(this);
  }
}
