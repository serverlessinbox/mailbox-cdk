import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { MAILBOX_ENDPOINTS, IMailboxDomainNames, MailboxEndpoint } from './mailbox-domains';

export type MailboxDnsCnameTargets = Partial<Record<MailboxEndpoint, string>>;

export interface DnsRecordDescriptor {
  readonly name: string;
  readonly type: string;
  readonly value: string;
  readonly ttlSeconds: string;
}

export interface MailboxDnsProps {
  readonly names: IMailboxDomainNames;

  /**
   * If provided, Route53 CNAME records will be created.
   * If omitted, record descriptors will be exposed on manualModeRecords.
   */
  readonly hostedZone?: route53.IHostedZone;

  /** CNAME values for each endpoint to publish (target hostname without protocol). */
  readonly cnameTargets: MailboxDnsCnameTargets;

  /** Default: 5 minutes */
  readonly ttl?: cdk.Duration;
}

export class MailboxDns extends Construct {
  /** When hostedZone is omitted, the DNS record descriptors to create manually. */
  public readonly manualModeRecords: DnsRecordDescriptor[] = [];

  constructor(scope: Construct, id: string, props: MailboxDnsProps) {
    super(scope, id);

    const ttl = props.ttl ?? cdk.Duration.minutes(5);
    const ttlSeconds = ttl.toSeconds().toString();

    for (const endpoint of MAILBOX_ENDPOINTS) {
      const target = props.cnameTargets[endpoint];
      if (!target) {
        continue;
      }

      const fqdn = props.names.fqdn(endpoint);

      if (props.hostedZone) {
        new route53.CnameRecord(this, `${endpoint}-cname`, {
          zone: props.hostedZone,
          recordName: props.names.relativeLabel(endpoint),
          domainName: target,
          ttl,
        });
      } else {
        this.manualModeRecords.push({
          name: fqdn,
          type: 'CNAME',
          value: target,
          ttlSeconds,
        });
      }
    }

    // Add JMAP SRV record for RFC 8620 §2.2 client autodiscovery
    const jmapTarget = props.cnameTargets['jmap'];
    if (jmapTarget) {
      if (props.hostedZone) {
        // Per RFC 8620 §2.2, SRV record name is always _jmap._tcp at the zone root,
        // with no namespace prefix. JMAP clients query for exactly this name.
        const srvRecordName = '_jmap._tcp';
        new route53.SrvRecord(this, 'jmap-srv', {
          zone: props.hostedZone,
          recordName: srvRecordName,
          ttl,
          values: [
            {
              priority: 0,
              weight: 1,
              port: 443,
              hostName: jmapTarget,
            },
          ],
        });
      } else {
        // Manual mode: store the SRV record details
        // SRV record name is always _jmap._tcp at the zone root, regardless of subdomainNamespace.
        const srvFqdn = `_jmap._tcp.${props.names.domainName}`;
        this.manualModeRecords.push({
          name: srvFqdn,
          type: 'SRV',
          value: `0 1 443 ${jmapTarget}`,
          ttlSeconds,
        });
      }
    }
  }
}
