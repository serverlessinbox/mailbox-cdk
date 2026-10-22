import { SqsActions } from '../sqs-actions';

describe('SqsActions', () => {
  it('contains no broader-than-necessary or wildcard actions', () => {
    const all = [...SqsActions.send, ...SqsActions.consume];
    for (const forbidden of ['sqs:GetQueueUrl', 'sqs:ChangeMessageVisibility', 'sqs:PurgeQueue', 'sqs:*', '*']) {
      expect(all).not.toContain(forbidden);
    }
  });
});
