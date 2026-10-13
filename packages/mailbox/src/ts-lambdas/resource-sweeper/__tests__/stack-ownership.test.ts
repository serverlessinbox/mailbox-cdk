/**
 * Coverage for `StackOwnership`, the gate in front of every sweep delete: only a resource tagged with
 * this sweep's root stack may be deleted. A missing owner tag must be a mismatch like a foreign one —
 * treating it as "unowned, so fair game" would let a sweep delete resources no stack claimed.
 */

import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { StackOwnership } from '../stack-ownership';

const OWNER_TAG_KEY = 'serverless-inbox:root-stack';
const ROOT_STACK = 'test-stack';

describe('StackOwnership', () => {
  const ownership = new StackOwnership(new LoggerBuffer());

  describe('mismatchInTagList', () => {
    it('finds no mismatch when the owner tag names this stack, among other tags', () => {
      const tags = [{ Key: 'other', Value: 'x' }, { Key: OWNER_TAG_KEY, Value: ROOT_STACK }];

      expect(ownership.mismatchInTagList(ROOT_STACK, 'ACM cert', tags)).toBeUndefined();
    });

    it('reports a foreign owner', () => {
      const tags = [{ Key: OWNER_TAG_KEY, Value: 'someone-elses-stack' }];

      expect(ownership.mismatchInTagList(ROOT_STACK, 'ACM cert', tags)).toBe(
        'Ownership mismatch (expected test-stack, got someone-elses-stack)',
      );
    });

    it('reports a resource without the owner tag, or without any tags, as a mismatch', () => {
      expect(ownership.mismatchInTagList(ROOT_STACK, 'ACM cert', [{ Key: 'other', Value: 'x' }])).toBe(
        'Ownership mismatch (expected test-stack, got undefined)',
      );
      expect(ownership.mismatchInTagList(ROOT_STACK, 'ACM cert', undefined)).toBe(
        'Ownership mismatch (expected test-stack, got undefined)',
      );
    });
  });

  describe('mismatchInTagMap', () => {
    it('finds no mismatch when the owner tag names this stack', () => {
      expect(ownership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [OWNER_TAG_KEY]: ROOT_STACK })).toBeUndefined();
    });

    it('reports a foreign owner, a missing owner tag and missing tags as mismatches', () => {
      expect(ownership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [OWNER_TAG_KEY]: 'someone-elses-stack' })).toBe(
        'Ownership mismatch (expected test-stack, got someone-elses-stack)',
      );
      expect(ownership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { other: 'x' })).toBe(
        'Ownership mismatch (expected test-stack, got undefined)',
      );
      expect(ownership.mismatchInTagMap(ROOT_STACK, 'Lambda function', undefined)).toBe(
        'Ownership mismatch (expected test-stack, got undefined)',
      );
    });
  });

  it('checks against the root stack it is asked about, not a fixed one', () => {
    const tags = { [OWNER_TAG_KEY]: 'other-root-stack' };

    expect(ownership.mismatchInTagMap('other-root-stack', 'Lambda function', tags)).toBeUndefined();
    expect(ownership.mismatchInTagMap(ROOT_STACK, 'Lambda function', tags)).toBe(
      'Ownership mismatch (expected test-stack, got other-root-stack)',
    );
  });

  it('logs a mismatch at warn level, labelled with the resource kind, and logs nothing for an owned resource', () => {
    const bufferedLogger = new LoggerBuffer(undefined, 'warn');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const buffered = new StackOwnership(bufferedLogger);

    buffered.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [OWNER_TAG_KEY]: ROOT_STACK });
    expect(warn).not.toHaveBeenCalled();

    buffered.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [OWNER_TAG_KEY]: 'someone-elses-stack' });
    expect(warn).toHaveBeenCalledWith('Lambda function ownership mismatch', {
      expectedStack: ROOT_STACK,
      actualStack: 'someone-elses-stack',
    });
    warn.mockRestore();
  });
});
