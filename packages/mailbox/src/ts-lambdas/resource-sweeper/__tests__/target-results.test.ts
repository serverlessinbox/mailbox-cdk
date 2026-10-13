/**
 * Coverage for `TargetResults`: the worker maps a sweep outcome to the status Step Functions branches
 * on, so each builder must set the status it is named after, carry the target label, and give only
 * `retry` and `failed` a reason.
 */

import { TargetResults } from '../target-results';

describe('TargetResults', () => {
  const results = new TargetResults('cert');

  it('builds done with the target and no reason', () => {
    expect(results.done()).toStrictEqual({ target: 'cert', status: 'done' });
  });

  it('builds retry with the target and the reason', () => {
    expect(results.retry('InUseBy: x')).toStrictEqual({ target: 'cert', status: 'retry', reason: 'InUseBy: x' });
  });

  it('builds failed with the target and the reason', () => {
    expect(results.failed('boom')).toStrictEqual({ target: 'cert', status: 'failed', reason: 'boom' });
  });
});
