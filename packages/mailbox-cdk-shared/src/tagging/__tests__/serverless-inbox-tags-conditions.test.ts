// Pins the exact IAM condition-key strings and the two-statement shape these helpers produce. Every
// caller that gates a grant on the root stack depends on the key being spelled identically everywhere
// it is constructed, and on IAM granting the union of the two statements: a resource tagged with the
// stack's id, or a resource without an id tag whose name tag equals the stack's name. A resource whose
// id tag names another stack must match neither.
import { ServerlessInboxTagKeys }                                        from '../serverless-inbox-tags';
import { rootStackRequestTagConditions, rootStackResourceTagConditions } from '../serverless-inbox-tags';

const ROOT_STACK = { name: 'MyRootStack', id: 'guid-1' };

describe('rootStackResourceTagConditions', () => {
  it('renders one statement keyed on the id tag and one on the name tag that requires the id tag to be absent', () => {
    expect(rootStackResourceTagConditions(ROOT_STACK)).toEqual([
      { StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`]: 'guid-1' } },
      {
        StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: 'MyRootStack' },
        Null: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`]: 'true' },
      },
    ]);
  });
});

describe('rootStackRequestTagConditions', () => {
  it('renders one statement keyed on the requested id tag and one on the requested name tag with the id tag absent from the request', () => {
    expect(rootStackRequestTagConditions(ROOT_STACK)).toEqual([
      { StringEquals: { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: 'guid-1' } },
      {
        StringEquals: { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStack}`]: 'MyRootStack' },
        Null: { [`aws:RequestTag/${ServerlessInboxTagKeys.rootStackId}`]: 'true' },
      },
    ]);
  });
});
