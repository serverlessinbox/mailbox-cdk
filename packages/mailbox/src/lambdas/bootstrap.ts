import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IReceiptRuleSet } from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';

export type SesReceivingMode = 'off' | 'on' | 'forced';

export interface BootstrapLambdaProps {
  configTable: ITable;
  authKeyStoreTable: ITable;
  artifactResolver: ICdkArtifactEngine;
  domain: string;
  sesRuleSet: IReceiptRuleSet;
  sesReceivingMode?: SesReceivingMode;
  /** When true, sets SES_SEND_ENABLED=on so the bootstrap marks the default domain as send-capable. */
  sesSendEnabled?: boolean;
  hostedZone?: route53.IHostedZone;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key used to identify resources belonging to this stack, sourced from the tag-key registry. */
  readonly stackIdentityTagKey: string;
}

export class BootstrapLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapLambdaProps) {
    super(scope, id, {
      lambdaId: 'bootstrap',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        STACK_IDENTITY_TAG_VALUE: Stack.of(scope).stackName,
        STACK_IDENTITY_TAG_KEY: props.stackIdentityTagKey,
      },
    });

    // Allow the bootstrap custom resource to ensure Service Quotas prerequisites are available.
    // This is expected to run at stack install time; runtime APIs should not need this permission.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: [
        'iam:CreateServiceLinkedRole',
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:AWSServiceName': 'servicequotas.amazonaws.com',
        },
      },
    }));

    props.configTable.grantReadWriteData(this);
    props.authKeyStoreTable.grantReadWriteData(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own. /grant-resource and /revoke-resource are
    // reached indirectly via shareddomainsvc.NewService(...) — scoping to /bootstrap alone breaks it.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: props.vendorAccountIds.flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/bootstrap`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));

    this.addEnvironment('SES_RULE_SET_NAME', props.sesRuleSet.receiptRuleSetName);
    if (props.sesReceivingMode) {
      this.addEnvironment('SES_RECEIVING_MODE', props.sesReceivingMode);
    }
    // Granted unconditionally: deactivateSESRuleSetIfActive (bootstrap Go handler) always calls
    // Describe, and calls SetActive (empty input, to release the slot) only if this stack turns
    // out to own the currently-active rule set — knowable only at delete time, never at synth
    // time, so no synth-time signal (sesReceivingMode) can predict it. Gating SetActive on the
    // mode would strand the on -> off -> delete case without the permission needed to release
    // the account's active slot.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['ses:SetActiveReceiptRuleSet', 'ses:DescribeActiveReceiptRuleSet'],
      resources: ['*'],
    }));

    if (props.sesSendEnabled) {
      this.addEnvironment('SES_SEND_ENABLED', 'on');
    }

    if (props.hostedZone) {
      this.addToRolePolicy(new PolicyStatement({
        actions: ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone'],
        resources: [`arn:aws:route53:::hostedzone/${props.hostedZone.hostedZoneId}`],
      }));
    }

    // Allow bootstrap to register and inspect the domain's SES email identity.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ses:CreateEmailIdentity',
        'ses:GetEmailIdentity',
        'ses:PutEmailIdentityDkimSigningAttributes',
      ],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${props.domain}`,
      ],
    }));

    // CreateEmailIdentity is called with a Tags parameter (the Go provisioner stamps the
    // stack-identity tag on create), which AWS co-authorizes against ses:TagResource. The
    // identity doesn't exist yet at that point, so aws:ResourceTag can't gate this — it would
    // always deny. Gate on aws:RequestTag (the tag being written) instead, and constrain
    // aws:TagKeys so this role can't ride along to write an unrelated tag key.
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ses:TagResource'],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${props.domain}`,
      ],
      conditions: {
        StringEquals: {
          [`aws:RequestTag/${props.stackIdentityTagKey}`]: Stack.of(this).stackName,
        },
        'ForAllValues:StringEquals': {
          'aws:TagKeys': [props.stackIdentityTagKey],
        },
      },
    }));
  }
}
