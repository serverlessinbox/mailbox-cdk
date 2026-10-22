/**
 * Coverage for `TargetResults`: Step Functions branches on the status of the worker's answer, so each
 * builder must set the status it is named after, carry the target label, and give only `retry` and
 * `failed` a reason.
 */

import { TargetResults } from '../target-results';

describe('TargetResults', () => {
  const results = new TargetResults('cert');

  it('builds done as SUCCESS with the target and no reason', () => {
    expect(results.done()).toStrictEqual({ target: 'cert', status: 'SUCCESS' });
  });

  it('builds retry as RETRY with the target and the reason', () => {
    expect(results.retry('InUseBy: x')).toStrictEqual({ target: 'cert', status: 'RETRY', reason: 'InUseBy: x' });
  });

  it('builds failed as FAILED with the target and the reason', () => {
    expect(results.failed('boom')).toStrictEqual({ target: 'cert', status: 'FAILED', reason: 'boom' });
  });
});
