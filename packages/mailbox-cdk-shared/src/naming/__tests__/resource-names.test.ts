import { App, Stack } from 'aws-cdk-lib';
import { makePhysicalName, slugifyLabel } from '../resource-names';

/**
 * Pins the physical-name scheme `<account>-<stack slug>-<suffix slug>` and its length cap. Physical
 * names of deployed resources derive from it, so a changed scheme renames them.
 */
function newStack(): Stack {
  return new Stack(new App(), 'TestStack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

describe('makePhysicalName', () => {
  it('joins the account, the sanitized stack name and the slugged suffix', () => {
    expect(makePhysicalName(newStack(), 'Admin UI')).toBe('111122223333-teststack-admin-ui');
  });

  it('leaves a name within maxLength unchanged', () => {
    expect(makePhysicalName(newStack(), 'Admin UI', { maxLength: 31 })).toBe('111122223333-teststack-admin-ui');
  });

  it('shortens a name over maxLength to exactly maxLength, ending in a hash of the full name', () => {
    const shortened = makePhysicalName(newStack(), 'a-long-suffix-for-the-name', { maxLength: 30 });

    expect(shortened).toMatch(/^111122223333-teststac-[0-9a-f]{8}$/);
  });

  it('keeps two long names that share their first characters distinct', () => {
    const first = makePhysicalName(newStack(), 'a-long-suffix-one', { maxLength: 30 });
    const second = makePhysicalName(newStack(), 'a-long-suffix-two', { maxLength: 30 });

    expect(first).not.toBe(second);
  });
});

describe('slugifyLabel', () => {
  it('turns a label into a lowercase hyphenated slug', () => {
    expect(slugifyLabel('Admin UI')).toBe('admin-ui');
  });

  it('collapses runs of separators and drops edge hyphens', () => {
    expect(slugifyLabel(' -Admin  &  UI- ')).toBe('admin-ui');
  });
});
