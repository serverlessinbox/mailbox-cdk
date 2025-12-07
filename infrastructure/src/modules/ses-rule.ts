import { Aws } from "aws-cdk-lib";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { ReceiptRule, ReceiptRuleSet, TlsPolicy } from "aws-cdk-lib/aws-ses";
import { S3, Lambda, LambdaInvocationType } from "aws-cdk-lib/aws-ses-actions";
import { Construct } from "constructs";

export interface SesRulesProps {
  emailBucket: IBucket
  emailProcessor: IFunction;
}

export class SesRules extends Construct {
  constructor(scope: Construct, id: string, props: SesRulesProps) {
    super(scope, id);
   // SES receipt rule set
    const ruleSet = new ReceiptRuleSet(this, 'email-rule-set', {
      receiptRuleSetName: 'mailbox-rules',
    });

    // SES receipt rule to store emails in S3
    const emailRule = new ReceiptRule(this, 'email-rule', {
      ruleSet: ruleSet,
      actions: [
        new S3({
          bucket: props.emailBucket,
          objectKeyPrefix: 'incoming-emails/',
          topic: undefined, // We'll use S3 notifications instead of SNS
        }),
        new Lambda({
          function: props.emailProcessor,
          invocationType: LambdaInvocationType.EVENT,
        })
      ],
      enabled: true,
      scanEnabled: true,
      tlsPolicy: TlsPolicy.REQUIRE,
    });

    // IAM policy for SES to write to S3
    const sesS3Policy = new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal('ses.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [`${props.emailBucket.bucketArn}/incoming-emails/*`],
      conditions: {
        StringEquals: {
          'aws:SourceAccount': Aws.ACCOUNT_ID,
        },
      },
    });

    props.emailBucket.addToResourcePolicy(sesS3Policy);
  }
}