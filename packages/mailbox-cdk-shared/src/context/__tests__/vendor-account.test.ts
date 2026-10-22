/// <reference types="jest" />

/**
 * Pins how the vendor account IDs are read from CDK context. The IDs end up as principals in trust
 * policies, so a customer install (no context) must get the built-in account, and a malformed value must
 * throw instead of producing a policy that trusts a wrong or non-account principal.
 */

import * as cdk                                        from 'aws-cdk-lib';

import { VENDOR_ACCOUNT_IDS_CONTEXT_KEY }              from '../context-keys';
import { VENDOR_ACCOUNT_ID, resolveVendorAccountIds }  from '../vendor-account';

function stackWith(value?: unknown): cdk.Stack {
  const context = value === undefined ? {} : { [VENDOR_ACCOUNT_IDS_CONTEXT_KEY]: value };
  return new cdk.Stack(new cdk.App({ context }), 'TestStack');
}

describe('resolveVendorAccountIds', () => {
  it('returns the built-in vendor account when the context key is absent', () => {
    expect(resolveVendorAccountIds(stackWith())).toEqual([VENDOR_ACCOUNT_ID]);
  });

  it('returns the built-in vendor account when the context value is null', () => {
    expect(resolveVendorAccountIds(stackWith(null))).toEqual([VENDOR_ACCOUNT_ID]);
  });

  it('returns the built-in vendor account when the context list is empty', () => {
    expect(resolveVendorAccountIds(stackWith([]))).toEqual([VENDOR_ACCOUNT_ID]);
  });

  it('returns the configured accounts', () => {
    expect(resolveVendorAccountIds(stackWith(['111122223333', '444455556666']))).toEqual(['111122223333', '444455556666']);
  });

  it.each([
    '111122223333',
    [111122223333],
  ])('throws naming the key when the value is %p', (value) => {
    expect(() => resolveVendorAccountIds(stackWith(value))).toThrow(
      `invalid CDK context value for "${VENDOR_ACCOUNT_IDS_CONTEXT_KEY}"`,
    );
  });

  it('throws when a configured account is not 12 digits', () => {
    expect(() => resolveVendorAccountIds(stackWith(['11112222333']))).toThrow('Invalid AWS account ID: 11112222333');
  });
});
