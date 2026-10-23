import type { IArtifactResolver }                                                                   from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda, ServerlessInboxTagKeys, StackIdentity, rootStackRequestTagConditions }           from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack, VendorLink }                                                               from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                                                          from 'aws-cdk-lib/aws-iam';
import type { IReceiptRuleSet }                                                                     from 'aws-cdk-lib/aws-ses';
import { Aws, Duration, Stack }                                                                     from 'aws-cdk-lib';
import { Construct }                                                                                from 'constructs';

import type { SesReceivingMode }                                                                    from '../../contracts/ses-receiving-mode';
import type { IDnsZone }                                                                            from '../../core/edge/dns-zone';
import type { IAuthKeyStoreTable }                                                                  from '../tables/auth-key-store-table';
import type { IDataTable }                                                                          from '../tables/data-tables';

export interface BootstrapLambdaProps {
  /** How long one bootstrap invocation may run. */
  readonly timeout:           Duration;
  readonly configTable:       IDataTable;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly artifactResolver:  IArtifactResolver;
  /** The domain whose SES email identity the bootstrap registers. */
  readonly domain:            string;
  readonly sesRuleSet:        IReceiptRuleSet;
  readonly sesReceivingMode?: SesReceivingMode;
  /** When true, sets SES_SEND_ENABLED to `on`. */
  readonly sesSendEnabled?: boolean;
  /** When present, the bootstrap role may manage records in this hosted zone. */
  readonly dnsZone?: IDnsZone;
  /** The vendor accounts that scope the execute-api:Invoke permission and the tag key that identifies this stack's resources (set as STACK_IDENTITY_TAG_KEY, used in the ses:TagResource condition). */
  readonly vendorLink: VendorLink;
}

/**
 * The bootstrap Lambda and its role. The role holds every grant the bootstrap needs, as named
 * grant methods. The environment, including the optional SES variables, is built from props
 * before the function is created.
 */
export class BootstrapLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapLambdaProps) {
    super(scope, id, {
      lambdaId:         'bootstrap',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      timeout:          props.timeout,
      environment:      {
        CONFIG_TABLE_NAME:         props.configTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
        STACK_IDENTITY_TAG_VALUE:  Stack.of(scope).stackName,
        STACK_IDENTITY_TAG_KEY:    props.vendorLink.stackIdentityTagKey,
        ROOT_STACK_ID:             StackIdentity.guid,
        SES_RULE_SET_NAME:         props.sesRuleSet.receiptRuleSetName,
        ...(props.sesReceivingMode ? { SES_RECEIVING_MODE: props.sesReceivingMode } : {}),
        ...(props.sesSendEnabled ? { SES_SEND_ENABLED: 'on' } : {}),
      },
    });

    this.grantServiceQuotasServiceLinkedRoleCreation();

    props.configTable.grantReadWrite(this);
    props.authKeyStoreTable.grantReadWrite(this);

    this.grantLicenseApiAccess(props.vendorLink.vendorAccountIds);
    this.grantSesReceiptRuleSetActivation();

    props.dnsZone?.grantRecordManagement(this);

    this.grantSesEmailIdentityRegistration(props.domain);
    this.grantSesEmailIdentityStackTagging(props.domain, props.vendorLink.stackIdentityTagKey);
    this.grantOwnStackStatusRead();
  }

  private grantOwnStackStatusRead(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions:   ['cloudformation:DescribeStacks'],
      resources: [Aws.STACK_ID],
    }));
  }

  private grantServiceQuotasServiceLinkedRoleCreation(): void {
    this.addToRolePolicy(new PolicyStatement({
      actions:    ['iam:CreateServiceLinkedRole'],
      resources:  ['*'],
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
      actions:   ['execute-api:Invoke'],
      resources: vendorAccountIds.flatMap((accountId) => [
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/bootstrap`,
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/grant-resource`,
        `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/revoke-resource`,
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
      actions:   ['ses:SetActiveReceiptRuleSet', 'ses:DescribeActiveReceiptRuleSet'],
      resources: ['*'],
    }));
  }

  private grantSesEmailIdentityRegistration(domain: string): void {
    this.addToRolePolicy(new PolicyStatement({
      actions:   [
        'ses:CreateEmailIdentity',
        'ses:GetEmailIdentity',
        'ses:PutEmailIdentityDkimSigningAttributes',
      ],
      resources: [
        `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${domain}`,
      ],
    }));
  }

  private grantSesEmailIdentityStackTagging(domain: string, stackIdentityTagKey: string): void {
    // CreateEmailIdentity is called with a Tags parameter (the Go provisioner stamps the
    // stack-identity tag on create), which AWS co-authorizes against ses:TagResource. The
    // identity doesn't exist yet at that point, so aws:ResourceTag can't gate this — it would
    // always deny. Gate on aws:RequestTag (the tag being written) instead, and constrain
    // aws:TagKeys so this role can't ride along to write an unrelated tag key.
    const rootStack: RootStack = { name: Stack.of(this).stackName, id: StackIdentity.guid };
    for (const conditions of rootStackRequestTagConditions(rootStack)) {
      this.addToRolePolicy(new PolicyStatement({
        actions:    ['ses:TagResource'],
        resources:  [
          `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/${domain}`,
        ],
        conditions: {
          ...conditions,
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [stackIdentityTagKey, ServerlessInboxTagKeys.rootStackId],
          },
        },
      }));
    }
  }
}
