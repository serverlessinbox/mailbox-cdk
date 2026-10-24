import { AllowListMatcher } from '../allow-list-matcher';

// Pins how the allow-list lookup matches a linted file path: whole-path suffix matching, `*` confined to one segment, and backslash-normalised paths.

describe('AllowListMatcher', () => {
  it('matches a file whose path ends with the listed path', () => {
    const matcher = new AllowListMatcher(['packages/mailbox/src/apis.ts']);

    expect(matcher.matches('/repo/packages/mailbox/src/apis.ts')).toBe(true);
  });

  it('keeps a * within one path segment', () => {
    const matcher = new AllowListMatcher(['packages/*/src/apis.ts']);

    expect(matcher.matches('/repo/packages/mailbox/src/apis.ts')).toBe(true);
    expect(matcher.matches('/repo/packages/a/b/src/apis.ts')).toBe(false);
  });

  it('normalises backslash separators before matching', () => {
    const matcher = new AllowListMatcher(['packages/mailbox/src/apis.ts']);

    expect(matcher.matches('C:\\repo\\packages\\mailbox\\src\\apis.ts')).toBe(true);
  });

  it('does not match a path that only shares a suffix with a listed file', () => {
    const matcher = new AllowListMatcher(['apis-section.ts']);

    expect(matcher.matches('/repo/packages/mailbox/src/apis-section.ts.bak')).toBe(false);
  });
});
