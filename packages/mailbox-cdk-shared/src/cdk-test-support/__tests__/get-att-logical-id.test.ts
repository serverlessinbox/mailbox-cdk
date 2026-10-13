/**
 * Pins how a test reads which resource an `Fn::GetAtt` points at: tests use it to prove that an IAM
 * grant and an environment variable name the same resource, so a wrong answer lets two resources that
 * drifted apart look identical.
 */

import { getAttLogicalId } from '../get-att-logical-id';

describe('getAttLogicalId', () => {
  it('returns the logical ID of an Fn::GetAtt', () => {
    expect(getAttLogicalId({ 'Fn::GetAtt': ['LogGroup', 'Arn'] })).toBe('LogGroup');
  });

  it('returns nothing for a Ref, which names a resource differently', () => {
    expect(getAttLogicalId({ Ref: 'LogGroup' })).toBeUndefined();
  });

  it('returns nothing for a plain string', () => {
    expect(getAttLogicalId('arn:aws:logs:::log-group:x')).toBeUndefined();
  });
});
