import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IReceiptRuleSet } from 'aws-cdk-lib/aws-ses';

export type SesReceivingMode = 'off' | 'on' | 'forced';

export interface BootstrapLambdaProps {
  configTable: ITable;
  jwkCacheTable: ITable;
  authKeyStoreTable: ITable;
  artifactResolver: ICdkArtifactResolver;
  domain: string;
  sesReceiving?: {
    ruleSet: IReceiptRuleSet;
    mode: SesReceivingMode;
  };
  /** When true, sets SES_SEND_ENABLED=on so the bootstrap marks the default domain as send-capable. */
  sesSendEnabled?: boolean;
}

export class BootstrapLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: BootstrapLambdaProps) {
    super(scope, id, {
      lambdaId: 'bootstrap',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      environment: {
        CONFIG_TABLE_NAME: props.configTable.tableName,
        JWK_CACHE_TABLE_NAME: props.jwkCacheTable.tableName,
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
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
    props.jwkCacheTable.grantReadWriteData(this);
    props.authKeyStoreTable.grantReadWriteData(this);

    // Required for SigV4-signed cross-account calls to the license API (API Gateway IAM auth)
    this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      actions: ['execute-api:Invoke'],
      resources: ['*'],
    }));

    if (props.sesReceiving) {
      const { ruleSet, mode } = props.sesReceiving;
      this.addEnvironment('SES_RULE_SET_NAME', ruleSet.receiptRuleSetName);
      this.addEnvironment('SES_RECEIVING_MODE', mode);
      this.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
        actions: ['ses:SetActiveReceiptRuleSet', 'ses:DescribeActiveReceiptRuleSet'],
        resources: ['*'],
      }));
    }

    if (props.sesSendEnabled) {
      this.addEnvironment('SES_SEND_ENABLED', 'on');
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
        `arn:aws:ses:${Stack.of(this).region}:${Stack.of(this).account}:identity/${props.domain}`,
      ],
    }));
  }
}
