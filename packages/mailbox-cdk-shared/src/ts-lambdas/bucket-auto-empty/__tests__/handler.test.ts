import { handler } from '../handler';

describe('BucketAutoEmpty handler — smoke test wrapper', () => {
  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent = { serverlessInboxSmokeTest: true };
    const result = await (handler as any)(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
  });
});
