import * as t from 'typanion';

import {
  isStackName,
  toRequestId,
  toStackName,
  type RequestId,
  type StackName,
} from '../custom-resource-identifiers';

/**
 * Pins what the shared custom-resource identifier kinds exist for: one kind cannot be passed where another is
 * expected, and a payload validator brands a string and reports a value that is not one. The swap is checked by
 * the compiler, so each `@ts-expect-error` below turns into a failure if the kinds ever become interchangeable.
 */
describe('custom-resource identifiers', () => {
  function describeStack(name: StackName): string {
    return name;
  }

  function describeRequest(id: RequestId): string {
    return id;
  }

  it('does not accept a stack name where a request id is expected, nor the other way round', () => {
    // @ts-expect-error a StackName is not a RequestId
    describeRequest(toStackName('mail-data'));
    // @ts-expect-error a RequestId is not a StackName
    describeStack(toRequestId('request-123'));
  });

  it('does not accept a plain string where a kind is expected', () => {
    // @ts-expect-error a plain string is not a StackName
    describeStack('mail-data');
  });

  describe('a validator', () => {
    it('accepts a string and reports a value that is not one', () => {
      expect(isStackName('mail-data')).toBe(true);
      expect(t.as(42, isStackName, { errors: true }).errors).toEqual(['.: Expected a string (got 42)']);
    });
  });
});
