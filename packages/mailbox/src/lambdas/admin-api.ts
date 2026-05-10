import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface AdminApiLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  auditLogTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  emailBucket: IBucket;
  emailSubmissionQueue: IQueue;
  auditEventsQueue: IQueue;
  artifactResolver: IArtifactResolver;
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
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        EMAIL_SUBMISSION_QUEUE_URL: props.emailSubmissionQueue.queueUrl,
      },
    });

    // Grant permissions BEFORE the Lambda is used by API Gateway
    this.grantStatusAccess();
    this.grantSesAccess();
    this.grantRoute53Access();
    this.grantServiceQuotasAccess();
    this.grantLicenseApiAccess();

    props.auditLogTable.grantReadData(this);
    props.mailFeedbackTable.grantReadData(this);

    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    props.auditEventsQueue.grantSendMessages(this);

    // Needed for standard JMAP email storage + submission enqueue
    props.emailBucket.grantReadWrite(this);
    props.emailSubmissionQueue.grantSendMessages(this);
  }
}
