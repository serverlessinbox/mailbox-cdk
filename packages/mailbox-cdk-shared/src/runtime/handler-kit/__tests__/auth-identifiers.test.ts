import { toAccountId, toIssuer, toTenantId, type AccountId, type Issuer, type TenantId } from '../auth-identifiers';

/**
 * Pins what the tenant, account and issuer kinds exist for: one cannot be passed where another is expected,
 * The swap is checked by the compiler, so each `@ts-expect-error` below turns into a failure if the kinds ever become interchangeable.
 */
describe('auth identifiers', () => {
  function describeTenant(tenant: TenantId): string {
    return tenant;
  }

  function describeAccount(account: AccountId): string {
    return account;
  }

  function describeIssuer(issuer: Issuer): string {
    return issuer;
  }

  it('does not accept one kind where another is expected', () => {
    // @ts-expect-error an AccountId is not a TenantId
    describeTenant(toAccountId('account-1'));
    // @ts-expect-error an Issuer is not an AccountId
    describeAccount(toIssuer('https://idp.example.com'));
    // @ts-expect-error a TenantId is not an Issuer
    describeIssuer(toTenantId('tenant-1'));
  });
});
