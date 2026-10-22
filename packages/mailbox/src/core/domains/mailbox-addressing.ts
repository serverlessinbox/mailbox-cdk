import * as cdk              from 'aws-cdk-lib';
import type { Construct }    from 'constructs';

import type { MailboxUrls }  from '../../mailbox-outputs';
import type { MailboxProps } from '../../mailbox-props';

import { MailboxDomains }    from './mailbox-domains';

/** The domain a Mailbox is reachable on, and the `MailboxProps` fields that shape its names. */
export interface MailboxAddressingProps extends Pick<MailboxProps, 'subdomainNamespace' | 'overrides'> {
  /** The base domain; absent when the Mailbox has no domain, which leaves it empty. */
  readonly domainName?: string;
}

/** Which UIs the Mailbox serves; a disabled UI gets no URL. */
export interface MailboxEnabledUis {
  readonly adminUi:   boolean;
  readonly webmailUi: boolean;
}

/**
 * Where a `Mailbox` is reachable: the condition that tells whether a subdomain namespace is set,
 * the endpoint domain names, the public URLs and the prefix the edge stack expects. Knows the
 * domain only as a name: it holds no hosted zone, no endpoint construct and creates no DNS record.
 *
 * Creates the namespace condition directly under the scope it receives, so its id and path are
 * those of the `Mailbox` itself.
 */
export class MailboxAddressing {
  private constructor(
    public readonly subdomainNamespaceCondition: cdk.CfnCondition | undefined,
    public readonly domains: MailboxDomains,
    public readonly urls: MailboxUrls,
    public readonly edgePrefix: string,
  ) {}

  /** Resolves the names, URLs and edge prefix of the domain in `props`. */
  public static resolve(
    scope: Construct,
    props: MailboxAddressingProps,
    enabledUis: MailboxEnabledUis,
  ): MailboxAddressing {
    const subdomainNamespaceCondition = MailboxAddressing.createNamespaceCondition(scope, props.subdomainNamespace);

    const domains = new MailboxDomains({
      domainName:          props.domainName,
      prefix:              props.subdomainNamespace,
      subdomainOverrides:  props.overrides?.subdomains,
      prefixConditionName: subdomainNamespaceCondition?.logicalId,
    });

    return new MailboxAddressing(
      subdomainNamespaceCondition,
      domains,
      MailboxAddressing.urlsOf(domains, enabledUis),
      MailboxAddressing.edgePrefixOf(domains, subdomainNamespaceCondition, props.subdomainNamespace),
    );
  }

  private static createNamespaceCondition(scope: Construct, subdomainNamespace: string | undefined): cdk.CfnCondition | undefined {
    if (subdomainNamespace === undefined) {
      return undefined;
    }

    return new cdk.CfnCondition(scope, 'HasSubdomainNamespace', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(subdomainNamespace, '')),
    });
  }

  private static urlsOf(domains: MailboxDomains, enabledUis: MailboxEnabledUis): MailboxUrls {
    return {
      ...(enabledUis.adminUi ? { adminUi: `https://${domains.admin}` } : {}),
      ...(enabledUis.webmailUi ? { webmailUi: `https://${domains.webmail}` } : {}),
      jmapApi:  `https://${domains.jmap}`,
      adminApi: `https://${domains.api}`,
    };
  }

  /** The edge stack expects "." for no namespace, or ".{label}." for a namespace. */
  private static edgePrefixOf(
    domains: MailboxDomains,
    namespaceCondition: cdk.CfnCondition | undefined,
    subdomainNamespace: string | undefined,
  ): string {
    if (namespaceCondition) {
      return cdk.Token.asString(cdk.Fn.conditionIf(
        namespaceCondition.logicalId,
        cdk.Fn.join('', ['.', subdomainNamespace ?? '', '.']),
        '.',
      ));
    }

    return domains.prefix ? `.${domains.prefix}.` : '.';
  }
}
