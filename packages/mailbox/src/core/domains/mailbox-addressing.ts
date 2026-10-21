import * as route53          from 'aws-cdk-lib/aws-route53';
import * as cdk              from 'aws-cdk-lib';
import type { Construct }    from 'constructs';

import { MailboxDomains }    from './mailbox-domains';
import type { MailboxUrls }  from '../../mailbox-outputs';
import type { MailboxProps } from '../../mailbox-props';

/** The `MailboxProps` fields the addressing is resolved from. */
type MailboxAddressingProps = Pick<MailboxProps, 'hostedZoneId' | 'subdomainNamespace' | 'overrides'>;

/** Which UIs the Mailbox serves; a disabled UI gets no URL. */
export interface MailboxEnabledUis {
  readonly adminUi: boolean;
  readonly webmailUi: boolean;
}

/**
 * Where a `Mailbox` is reachable: the hosted zone, the condition that tells whether a subdomain
 * namespace is set, the endpoint domain names, the public URLs and the prefix the edge stack
 * expects. Holds no endpoint construct and creates no DNS record.
 *
 * Creates the zone import and the namespace condition directly under the scope it receives, so
 * their ids and paths are those of the `Mailbox` itself.
 */
export class MailboxAddressing {
  private constructor(
    public readonly zone: route53.IHostedZone,
    public readonly subdomainNamespaceCondition: cdk.CfnCondition | undefined,
    public readonly domains: MailboxDomains,
    public readonly urls: MailboxUrls,
    public readonly edgePrefix: string,
  ) {}

  /** Resolves the addressing for `domainName`, the domain derived from the hosted zone at deploy time. */
  public static resolve(
    scope: Construct,
    props: MailboxAddressingProps,
    domainName: string,
    enabledUis: MailboxEnabledUis,
  ): MailboxAddressing {
    const zone = route53.HostedZone.fromHostedZoneAttributes(scope, 'zone', {
      hostedZoneId: props.hostedZoneId ?? '',
      zoneName: domainName,
    });

    const subdomainNamespaceCondition = props.subdomainNamespace !== undefined
      ? new cdk.CfnCondition(scope, 'HasSubdomainNamespace', {
          expression: cdk.Fn.conditionNot(
            cdk.Fn.conditionEquals(props.subdomainNamespace, ''),
          ),
        })
      : undefined;

    const domains = new MailboxDomains({
      domainName,
      prefix: props.subdomainNamespace,
      subdomainOverrides: props.overrides?.subdomains,
      prefixConditionName: subdomainNamespaceCondition?.logicalId,
    });

    const urls: MailboxUrls = {
      ...(enabledUis.adminUi ? { adminUi: `https://${domains.admin}` } : {}),
      ...(enabledUis.webmailUi ? { webmailUi: `https://${domains.webmail}` } : {}),
      jmapApi:  `https://${domains.jmap}`,
      adminApi: `https://${domains.api}`,
    };

    // The edge stack expects "." for no namespace, or ".{label}." for a namespace.
    const edgePrefix: string = subdomainNamespaceCondition
      ? (cdk.Fn.conditionIf(
          subdomainNamespaceCondition.logicalId,
          cdk.Fn.join('', ['.', props.subdomainNamespace ?? '', '.']),
          '.',
        ) as unknown as string)
      : domains.prefix
        ? `.${domains.prefix}.`
        : '.';

    return new MailboxAddressing(
      zone,
      subdomainNamespaceCondition,
      domains,
      urls,
      edgePrefix,
    );
  }
}
