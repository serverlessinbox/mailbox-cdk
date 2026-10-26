/// <reference types="jest" />

/**
 * EmailSenderLambda: the names and SES configuration set it hands the Go handler, the grants it
 * requests for itself on its tables, blob store and queue, the queue event it registers, the
 * websocket push wiring, and the one statement it adds itself: ses:SendRawEmail, scoped to the
 * identity and configuration-set ARNs with no condition because SES ignores resource-tag conditions
 * for SendRawEmail. The statement each requested grant renders is pinned by the resource that owns it.
 */

import { statementsForAction }                                                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                                                         from 'aws-cdk-lib/assertions';

import type { IWebSocketBroadcastPublisher }                                                from '../../../contracts/websocket-push';
import { EmailSubmissionsQueueEvent }                                                       from '../../events/email-submissions-queue-event';
import { EmailSenderLambda }                                                                from '../email-sender-lambda';

import { expectGrantedOnceTo, fakeDataBlobStore, fakeDataTable, fakeQueue }                 from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                                from './lambda-wrapper-helpers';

jest.mock('../../events/email-submissions-queue-event');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeDataTable('config-table');
  const itemTable                   = fakeDataTable('item-table');
  const changelogTable              = fakeDataTable('changelog-table');
  const blobStore                   = fakeDataBlobStore('blob-store');
  const submissionQueue             = fakeQueue('email-submissions');
  const lambda                      = new EmailSenderLambda(stack, 'email-sender', {
    configTable,
    itemTable,
    changelogTable,
    blobStore,
    sesConfigSetName: 'test-config-set',
    submissionQueue,
    artifactResolver,
  });

  return { lambda, stack, configTable, itemTable, changelogTable, blobStore, submissionQueue };
}

describe('EmailSenderLambda', () => {
  beforeEach(() => {
    jest.mocked(EmailSubmissionsQueueEvent).mockClear();
  });

  it('passes the blob store, table and SES configuration set names to the handler', () => {
    const { stack } = synthesize();

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({
      BLOB_STORE_NAME:      'blob-store',
      CONFIG_TABLE_NAME:    'config-table',
      ITEM_TABLE_NAME:      'item-table',
      CHANGELOG_TABLE_NAME: 'changelog-table',
      SES_CONFIG_SET_NAME:  'test-config-set',
    });
  });

  it('requests read on the config table and read-write on the item and changelog tables for itself', () => {
    const { lambda, configTable, itemTable, changelogTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
    expectGrantedOnceTo(itemTable.grantReadWrite, lambda);
    expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
  });

  it('requests email-blob read on the blob store for itself', () => {
    const { lambda, blobStore } = synthesize();

    expectGrantedOnceTo(blobStore.grantEmailBlobRead, lambda);
  });

  it('requests consume on the submissions queue for itself', () => {
    const { lambda, submissionQueue } = synthesize();

    expectGrantedOnceTo(submissionQueue.grantConsume, lambda);
  });

  it('registers one queue event that delivers the submissions queue to itself', () => {
    const { lambda, submissionQueue } = synthesize();

    expect(EmailSubmissionsQueueEvent).toHaveBeenCalledTimes(1);
    expect(EmailSubmissionsQueueEvent).toHaveBeenCalledWith(lambda, 'email-submissions-queue', { target: lambda, queue: submissionQueue });
  });

  it('scopes ses:SendRawEmail to the identity and the configuration-set ARNs without condition', () => {
    const { stack } = synthesize();

    const statements = statementsForAction(Template.fromStack(stack), 'ses:SendRawEmail');

    expect(statements).toEqual([
      {
        Action:   'ses:SendRawEmail',
        Effect:   'Allow',
        Resource: [
          { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':identity/*']] },
          { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':ses:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':configuration-set/test-config-set']] },
        ],
      },
    ]);
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the broadcaster grant itself invokable', () => {
    const { lambda, stack }                         = synthesize();
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush(broadcaster);

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn' });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
