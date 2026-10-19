import { Construct } from 'constructs';
import type { IDataTable } from '../data/data-tables';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IReceiptRuleSet } from 'aws-cdk-lib/aws-ses';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';
import type { IAuthKeyStoreTable } from '../features/auth-key-store/auth-key-store-table';
import type { SesReceivingMode } from '../core/email/ses-receiving-mode';

export const BOOTSTRAP_LAMBDA_TIMEOUT = Duration.seconds(30);

export interface BootstrapLambdaProps {
  readonly configTable: IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly artifactResolver: IArtifactResolver;
  /** The domain whose SES email identity the bootstrap registers. */
  readonly domain: string;
  readonly sesRuleSet: IReceiptRuleSet;
  readonly sesReceivingMode?: SesReceivingMode;
  /** When true, sets SES_SEND_ENABLED to `on`. */
  readonly sesSendEnabled?: boolean;
  /** When present, the bootstrap role may manage records in this hosted zone. */
  readonly hostedZone?: IHostedZone;
  /** AWS account IDs hosting the vendor service API. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key identifying this stack's resources. Set as STACK_IDENTITY_TAG_KEY and used in the ses:TagResource condition. */
  readonly stackIdentityTagKey: string;
}

/**
 * The bootstrap Lambda and its role. The role holds every grant the bootstrap needs, as named
 * grant methods. The environment, including the optional SES variables, is built from props
 * before the function is created.
 */
export class BootstrapLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapLambdaProps) {
    super(scope, id, {
      lambdaId: 'bootstrap',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: BOOTSTRAP_LAMBDA_TIMEOUT,
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        STACK_IDENTITY_TAG_VALUE: Stack.of(scope).stackName,
        STACK_IDENTITY_TAG_KEY: props.stackIdentityTagKey,
        SES_RULE_SET_NAME: props.sesRuleSet.receiptRuleSetName,
        ...(props.sesReceivingMode ? { SES_RECEIVING_MODE: props.sesReceivingMode } : {}),
        ...(props.sesSendEnabled ? { SES_SEND_ENABLED: 'on' } : {}),
      },
    });

    this.grantServiceQuotasServiceLinkedRoleCreation();

    props.configTable.grantReadWrite(this);
    props.authKeyStoreTable.grantReadWrite(this);

    this.grantLicenseApiAccess(props.vendorAccountIds);
    this.grantSesReceiptRuleSetActivation();

    if (props.hostedZone) {
      this.grantHostedZoneRecordManagement(props.hostedZone.hostedZoneId);
    }

    this.grantSesEmailIdentityRegistration(props.domain);
    this.grantSesEmailIdentityStackTagging(props.domain, props.stackIdentityTagKey);
    this.grantOwnStackStatusRead();
  }

  private grantOwnStackStatusRead(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['cloudformation:DescribeStacks'],
      resources: [Aws.STACK_ID],
    }));
  }

  private grantServiceQuotasServiceLinkedRoleCreation(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['iam:CreateServiceLinkedRole'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:AWSServiceName': 'servicequotas.amazonaws.com',
        },
      },
    }));
  }

  private grantLicenseApiAccess(vendorAccountIds: string[]): void {
    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth).
    // ApiId/Stage/Region stay wildcarded: the vendor's API ID is random and its stage name is a
    // vendor deploy detail this repo does not own. /grant-resource and /revoke-resource are
    // reached indirectly via shareddomainsvc.NewService(...) — scoping to /bootstrap alone breaks it.
    this.addToRolePolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:aws:execute-api:*:${accountId}:*/*/POST/bootstrap`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:aws:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
      ]),
    }));
  }

  private grantSesReceiptRuleSetActivation(): void {
    // Granted unconditionally: deactivateSESRuleSetIfActive (bootstrap Go handler) always calls
    // Describe, and calls SetActive (empty input, to release the slot) only if this stack turns
    // out to own the currently-active rule set — knowable only at delete time, never at synth
    // time, so no synth-time signal (sesReceivingMode) can predict it. Gating SetActive on the
    // mode would strand the on -> off -> delete case without the permission needed to release
    // the account's active slot.
    this.addToRolePolicy(new PolicyStatement({
      actions: ['ses:SetActiveReceiptRuleSet', 'ses:DescribeActiveReceiptRuleSet'],
      resources: ['*'],
    }));
  }

  private grantHostedZoneRecordManagement(hostedZoneId: string): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone'],
      resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
    }));
  }

  private grantSesEmailIdentityRegistration(domain: string): void {
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'ses:CreateEmailIdentity',
        'ses:GetEmailIdentity',
        'ses:PutEmailIdentityDkimSigningAttributes',
      ],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${domain}`,
      ],
    }));
  }

  private grantSesEmailIdentityStackTagging(domain: string, stackIdentityTagKey: string): void {
    // CreateEmailIdentity is called with a Tags parameter (the Go provisioner stamps the
    // stack-identity tag on create), which AWS co-authorizes against ses:TagResource. The
    // identity doesn't exist yet at that point, so aws:ResourceTag can't gate this — it would
    // always deny. Gate on aws:RequestTag (the tag being written) instead, and constrain
    // aws:TagKeys so this role can't ride along to write an unrelated tag key.
    this.addToRolePolicy(new PolicyStatement({
      actions: ['ses:TagResource'],
      resources: [
        `arn:aws:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${domain}`,
      ],
      conditions: {
        StringEquals: {
          [`aws:RequestTag/${stackIdentityTagKey}`]: Stack.of(this).stackName,
        },
        'ForAllValues:StringEquals': {
          'aws:TagKeys': [stackIdentityTagKey],
        },
      },
    }));
  }
}
