import { Construct }                      from 'constructs';

import { VENDOR_ACCOUNT_IDS_CONTEXT_KEY } from './context-keys';

/**
 * The vendor-side values a stack is wired to: the vendor AWS accounts that may call into it, and
 * the tag key that identifies the stack in their policies. They are always supplied together.
 */
export interface VendorLink {
  readonly vendorAccountIds: string[];
  readonly stackIdentityTagKey: string;
}

/**
 * Built-in ServerlessInbox production vendor AWS account ID.
 * It appears in the support-hop role's static trust policy (as a :root principal) and is
 * customer-readable in the template. Overridden via the VENDOR_ACCOUNT_IDS_CONTEXT_KEY CDK
 * context key (e.g. so a non-production license-server can also be trusted).
 */
export const VENDOR_ACCOUNT_ID = '791990038981';

/**
 * Resolve the vendor AWS account IDs permitted to assume the support hop role.
 *
 * Reads the VENDOR_ACCOUNT_IDS_CONTEXT_KEY CDK context key (context resolution walks up the
 * construct tree to the App, so any construct in the tree resolves the same value), falling
 * back to the built-in production account when unset — a customer install passes no CDK context
 * at all, so absence must never throw. Validates that every resolved account ID is a 12-digit
 * string, throwing when a value is present but malformed — this context is an internal
 * dev-stack testing mechanism, never customer-configurable.
 *
 * Called once from a composition root (`Mailbox`, or an addon's own top-level construct) and
 * threaded down as a prop — never called from a Lambda construct class.
 *
 * @param scope Construct used to read CDK context.
 * @returns Array of validated 12-digit AWS account IDs.
 * @throws Error if the context value is present but not an array of strings, or if any
 *   resolved account ID is not a 12-digit string.
 */
export function resolveVendorAccountIds(scope: Construct): string[] {
  const contextValue = scope.node.tryGetContext(VENDOR_ACCOUNT_IDS_CONTEXT_KEY);

  let resolved: string[];
  if (contextValue === undefined || contextValue === null) {
    resolved = [VENDOR_ACCOUNT_ID];
  } else if (Array.isArray(contextValue) && contextValue.every((id) => typeof id === 'string')) {
    resolved = contextValue.length > 0 ? contextValue : [VENDOR_ACCOUNT_ID];
  } else {
    throw new Error(
      `@serverlessinbox/mailbox: invalid CDK context value for "${VENDOR_ACCOUNT_IDS_CONTEXT_KEY}": ` +
      `${JSON.stringify(contextValue)}. Must be an array of account ID strings.`
    );
  }

  for (const accountId of resolved) {
    if (!/^\d{12}$/.test(accountId)) {
      throw new Error(
        `Invalid AWS account ID: ${accountId}. Account IDs must be 12-digit strings.`
      );
    }
  }

  return resolved;
}
