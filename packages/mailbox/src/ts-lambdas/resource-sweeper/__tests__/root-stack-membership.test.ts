/**
 * Coverage for `RootStackMembership`, the gate in front of every sweep delete: only a resource that belongs
 * to this sweep's root stack may be deleted. A resource with a `root-stack-id` tag belongs to the stack with
 * that guid whatever its name tag says, so a stack recreated under the same name cannot claim a predecessor's
 * resources; only a resource that has no id tag is matched on its `root-stack` name. A missing root-stack tag
 * is a mismatch like a foreign one: treating it as "claimed by no stack, so fair game" would let a sweep
 * delete resources no stack claimed.
 */

import { LoggerBuffer }        from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { RootStackMembership } from '../root-stack-membership';

const NAME_TAG_KEY = 'serverless-inbox:root-stack';
const ID_TAG_KEY   = 'serverless-inbox:root-stack-id';
const ROOT_STACK   = { rootStackName: 'test-stack', rootStackId: 'guid-1' };

describe('RootStackMembership', () => {
  const membership = new RootStackMembership(new LoggerBuffer());

  describe('the membership rule', () => {
    it('belongs when the id tag equals the stack id', () => {
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [ID_TAG_KEY]: 'guid-1', [NAME_TAG_KEY]: 'test-stack' })).toBeUndefined();
    });

    it('belongs by the id alone when the name tag differs', () => {
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [ID_TAG_KEY]: 'guid-1', [NAME_TAG_KEY]: 'renamed' })).toBeUndefined();
    });

    it('does not belong when the id tag names another stack, even if the name tag matches', () => {
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [ID_TAG_KEY]: 'guid-2', [NAME_TAG_KEY]: 'test-stack' })).toBe(
        'Root stack mismatch (expected test-stack / guid-1, got test-stack / guid-2)',
      );
    });

    it('belongs when there is no id tag and the name tag equals the stack name', () => {
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [NAME_TAG_KEY]: 'test-stack' })).toBeUndefined();
    });

    it('does not belong when there is no id tag and the name tag names another stack', () => {
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [NAME_TAG_KEY]: 'someone-elses-stack' })).toBe(
        'Root stack mismatch (expected test-stack / guid-1, got someone-elses-stack / undefined)',
      );
    });

    it('does not belong without any root-stack tag, or without any tags', () => {
      const expected = 'Root stack mismatch (expected test-stack / guid-1, got undefined / undefined)';

      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', { other: 'x' })).toBe(expected);
      expect(membership.mismatchInTagMap(ROOT_STACK, 'Lambda function', undefined)).toBe(expected);
    });
  });

  describe('mismatchInTagList', () => {
    it('reads the root-stack tags among other tags', () => {
      const tags = [{ Key: 'other', Value: 'x' }, { Key: ID_TAG_KEY, Value: 'guid-1' }];

      expect(membership.mismatchInTagList(ROOT_STACK, 'ACM cert', tags)).toBeUndefined();
    });

    it('falls back to the name tag when the list has no id tag', () => {
      expect(membership.mismatchInTagList(ROOT_STACK, 'ACM cert', [{ Key: NAME_TAG_KEY, Value: 'test-stack' }])).toBeUndefined();
    });

    it('reports a foreign id, and a list without root-stack tags or without entries, as a mismatch', () => {
      expect(membership.mismatchInTagList(ROOT_STACK, 'ACM cert', [{ Key: ID_TAG_KEY, Value: 'guid-2' }])).toBe(
        'Root stack mismatch (expected test-stack / guid-1, got undefined / guid-2)',
      );
      expect(membership.mismatchInTagList(ROOT_STACK, 'ACM cert', [{ Key: 'other', Value: 'x' }])).toBeDefined();
      expect(membership.mismatchInTagList(ROOT_STACK, 'ACM cert', undefined)).toBeDefined();
    });
  });

  it('logs a mismatch at warn level, labelled with the resource kind, and logs nothing for a resource of the root stack', () => {
    const bufferedLogger = new LoggerBuffer(undefined, 'warn');
    const warn           = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const buffered       = new RootStackMembership(bufferedLogger);

    buffered.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [ID_TAG_KEY]: 'guid-1' });
    expect(warn).not.toHaveBeenCalled();

    buffered.mismatchInTagMap(ROOT_STACK, 'Lambda function', { [ID_TAG_KEY]: 'guid-2', [NAME_TAG_KEY]: 'someone-elses-stack' });
    expect(warn).toHaveBeenCalledWith('Lambda function root stack mismatch', {
      expectedStackId: 'guid-1',
      expectedStack: 'test-stack',
      actualStackId: 'guid-2',
      actualStack: 'someone-elses-stack',
    });
    warn.mockRestore();
  });
});
