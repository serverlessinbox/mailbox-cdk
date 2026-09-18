// Pins the exact IAM condition-key strings these two helpers produce. Every caller that gates a
// grant on the root-stack tag depends on the key being spelled identically everywhere it's
// constructed; a typo or prefix drift here would silently desynchronize IAM conditions written by
// hand at each call site (see mailbox-edge-deployer-worker.ts, artifact-updater.ts, etc.).
import { ServerlessInboxTagKeys } from '../serverless-inbox-tags';
import { rootStackRequestTagCondition, rootStackResourceTagCondition } from '../serverless-inbox-tags';

describe('rootStackResourceTagCondition', () => {
  it('keys the value under aws:ResourceTag/<root-stack tag key>', () => {
    expect(rootStackResourceTagCondition('MyRootStack')).toEqual({
      [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: 'MyRootStack',
    });
  });
});

describe('rootStackRequestTagCondition', () => {
  it('keys the value under aws:RequestTag/<root-stack tag key>', () => {
    expect(rootStackRequestTagCondition('MyRootStack')).toEqual({
      [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: 'MyRootStack',
    });
  });
});
