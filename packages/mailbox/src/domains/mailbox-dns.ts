import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { MAILBOX_ENDPOINTS, IMailboxDomainNames, MailboxEndpoint } from './mailbox-domains';

/** The CNAME target (hostname without protocol) to publish for each endpoint; an endpoint without one gets no record. */
export type MailboxDnsCnameTargets = Partial<Record<MailboxEndpoint, string>>;

/** The kinds of DNS record {@link MailboxDns} creates. */
export type DnsRecordType = 'CNAME' | 'SRV';

/** One DNS record for the operator to create by hand, because no hosted zone was given. */
export interface DnsRecordDescriptor {
  /** Fully qualified record name. */
  readonly name: string;
  readonly type: DnsRecordType;
  readonly value: string;
  readonly ttlSeconds: string;
}

/** Inputs of {@link MailboxDns}: the endpoint names, their CNAME targets and, optionally, the hosted zone to write into. */
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

/**
 * The DNS records that point the mailbox endpoints at their targets: a CNAME per endpoint that has
 * a target, plus the JMAP SRV record for client autodiscovery.
 *
 * With a hosted zone it creates the Route53 records. Without one it creates nothing and lists the
 * records on `manualModeRecords` instead. It does not create the targets it points at.
 */
export class MailboxDns extends Construct {
  /** When hostedZone is omitted, the DNS record descriptors to create manually. */
  public readonly manualModeRecords: DnsRecordDescriptor[] = [];

  constructor(scope: Construct, id: string, props: MailboxDnsProps) {
    super(scope, id);

    const ttl = props.ttl ?? cdk.Duration.minutes(5);

    for (const endpoint of MAILBOX_ENDPOINTS) {
      const target = props.cnameTargets[endpoint];
      if (target) {
        this.publishCname(props, endpoint, target, ttl);
      }
    }

    const jmapTarget = props.cnameTargets['jmap'];
    if (jmapTarget) {
      this.publishJmapSrv(props, jmapTarget, ttl);
    }
  }

  private publishCname(props: MailboxDnsProps, endpoint: MailboxEndpoint, target: string, ttl: cdk.Duration): void {
    if (props.hostedZone) {
      new route53.CnameRecord(this, `${endpoint}-cname`, {
        zone: props.hostedZone,
        recordName: props.names.relativeLabel(endpoint),
        domainName: target,
        ttl,
      });
    } else {
      this.manualModeRecords.push({
        name: props.names.fqdn(endpoint),
        type: 'CNAME',
        value: target,
        ttlSeconds: ttl.toSeconds().toString(),
      });
    }
  }

  /**
   * RFC 8620 §2.2 clients query exactly `_jmap._tcp` at the zone root, so the record name carries
   * no subdomain namespace, whatever the endpoint names are.
   */
  private publishJmapSrv(props: MailboxDnsProps, jmapTarget: string, ttl: cdk.Duration): void {
    if (props.hostedZone) {
      new route53.SrvRecord(this, 'jmap-srv', {
        zone: props.hostedZone,
        recordName: '_jmap._tcp',
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
      this.manualModeRecords.push({
        name: `_jmap._tcp.${props.names.domainName}`,
        type: 'SRV',
        value: `0 1 443 ${jmapTarget}`,
        ttlSeconds: ttl.toSeconds().toString(),
      });
    }
  }
}
