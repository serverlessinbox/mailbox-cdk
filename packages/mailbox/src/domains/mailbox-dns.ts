import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { MAILBOX_ENDPOINTS, IMailboxDomainNames, MailboxEndpoint } from './mailbox-domains';

export type MailboxDnsCnameTargets = Partial<Record<MailboxEndpoint, string>>;

export interface MailboxDnsProps {
  readonly names: IMailboxDomainNames;

  /**
   * If provided, Route53 CNAME records will be created.
   * If omitted, CloudFormation outputs will describe the records to create externally.
   */
  readonly hostedZone?: route53.IHostedZone;

  /** CNAME values for each endpoint to publish (target hostname without protocol). */
  readonly cnameTargets: MailboxDnsCnameTargets;

  /** Default: 5 minutes */
  readonly ttl?: cdk.Duration;

  /** Output name prefix (for manual mode). Default: "MailboxDns" */
  readonly outputPrefix?: string;
}

export class MailboxDns extends Construct {
  constructor(scope: Construct, id: string, props: MailboxDnsProps) {
    super(scope, id);

    const ttl = props.ttl ?? cdk.Duration.minutes(5);
    const outputPrefix = props.outputPrefix ?? 'MailboxDns';

    for (const endpoint of MAILBOX_ENDPOINTS) {
      const target = props.cnameTargets[endpoint];
      if (!target) {
        continue;
      }

      const fqdn = props.names.fqdn(endpoint);

      if (props.hostedZone) {
        new route53.CnameRecord(this, `${endpoint}-cname`, {
          zone: props.hostedZone,
          recordName: relativeRecordName(fqdn, props.hostedZone.zoneName),
          domainName: target,
          ttl,
        });
      } else {
        new cdk.CfnOutput(this, `${outputPrefix}${capitalize(endpoint)}RecordName`, {
          value: fqdn,
        });
        new cdk.CfnOutput(this, `${outputPrefix}${capitalize(endpoint)}RecordType`, {
          value: 'CNAME',
        });
        new cdk.CfnOutput(this, `${outputPrefix}${capitalize(endpoint)}RecordValue`, {
          value: target,
        });
        new cdk.CfnOutput(this, `${outputPrefix}${capitalize(endpoint)}RecordTtlSeconds`, {
          value: ttl.toSeconds().toString(),
        });
      }
    }
  }
}

function relativeRecordName(fqdn: string, zoneName: string): string {
  const normalizedZone = zoneName.replace(/\.+$/, '').toLowerCase();
  const normalizedFqdn = fqdn.replace(/\.+$/, '').toLowerCase();

  if (normalizedFqdn === normalizedZone) {
    throw new Error(`Refusing to create apex record for zone ${zoneName}`);
  }

  const suffix = `.${normalizedZone}`;
  if (!normalizedFqdn.endsWith(suffix)) {
    throw new Error(`FQDN ${fqdn} is not inside hosted zone ${zoneName}`);
  }

  return normalizedFqdn.slice(0, -suffix.length);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
