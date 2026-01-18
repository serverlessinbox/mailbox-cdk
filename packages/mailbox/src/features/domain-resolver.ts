export {
  MailboxDomains,
  MailboxDomainNames,
  MailboxDomainNamesProps,
  MailboxDomainContext,
  MailboxDomainContextProps,
  MailboxDns,
  MailboxDnsProps,
  MailboxEndpoint,
  MAILBOX_ENDPOINTS,
} from '../domains';

import { MailboxDomains } from '../domains';
import type { MailboxDomainNamesProps } from '../domains';

// Backwards-compatible names (the previous file was a stub and unused, but this avoids churn).
export type DomainResolverProps = MailboxDomainNamesProps;
export const DomainResolver = MailboxDomains;