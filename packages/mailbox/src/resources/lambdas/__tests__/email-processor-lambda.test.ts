/// <reference types="jest" />

/**
 * EmailProcessorLambda: the table, blob store names it hands the Go handler, the grants it requests
 * for itself on its tables, blob store and queue, the queue event it registers, and the websocket
 * push wiring it takes through enableWebSocketPush. The statement each grant renders and the mapping
 * the event renders are pinned by the resource and the event that own them, not here.
 */

import { Template }                                                                         from 'aws-cdk-lib/assertions';

import type { IWebSocketBroadcastPublisher }                                                from '../../../contracts/websocket-push';
import { EmailProcessingQueueEvent }                                                        from '../../events/email-processing-queue-event';
import { EmailProcessorLambda }                                                             from '../email-processor-lambda';

import { expectGrantedOnceTo, fakeDataBlobStore, fakeDataTable, fakeQueue }                 from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                                from './lambda-wrapper-helpers';

jest.mock('../../events/email-processing-queue-event');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeDataTable('config-table');
  const itemTable                   = fakeDataTable('item-table');
  const changelogTable              = fakeDataTable('changelog-table');
  const blobStore                   = fakeDataBlobStore('blob-store');
  const emailProcessingQueue        = fakeQueue('email-processing');
  const lambda                      = new EmailProcessorLambda(stack, 'email-processor', {
    configTable,
    itemTable,
    changelogTable,
    blobStore,
    emailProcessingQueue,
    artifactResolver,
  });

  return { lambda, stack, configTable, itemTable, changelogTable, blobStore, emailProcessingQueue };
}

describe('EmailProcessorLambda', () => {
  beforeEach(() => {
    jest.mocked(EmailProcessingQueueEvent).mockClear();
  });

  it('passes the blob store and table names to the handler', () => {
    const { stack } = synthesize();

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({
      BLOB_STORE_NAME:      'blob-store',
      CONFIG_TABLE_NAME:    'config-table',
      ITEM_TABLE_NAME:      'item-table',
      CHANGELOG_TABLE_NAME: 'changelog-table',
    });
  });

  it('requests read-write on the config, item and changelog tables for itself', () => {
    const { lambda, configTable, itemTable, changelogTable } = synthesize();

    expectGrantedOnceTo(configTable.grantReadWrite, lambda);
    expectGrantedOnceTo(itemTable.grantReadWrite, lambda);
    expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
  });

  it('requests incoming-email consume and email-blob write on the blob store for itself', () => {
    const { lambda, blobStore } = synthesize();

    expectGrantedOnceTo(blobStore.grantIncomingEmailConsume, lambda);
    expectGrantedOnceTo(blobStore.grantEmailBlobWrite, lambda);
  });

  it('requests consume on the email-processing queue for itself', () => {
    const { lambda, emailProcessingQueue } = synthesize();

    expectGrantedOnceTo(emailProcessingQueue.grantConsume, lambda);
  });

  it('registers one queue event that delivers the email-processing queue to itself', () => {
    const { lambda, emailProcessingQueue } = synthesize();

    expect(EmailProcessingQueueEvent).toHaveBeenCalledTimes(1);
    expect(EmailProcessingQueueEvent).toHaveBeenCalledWith(lambda, 'email-processing-queue', { target: lambda, queue: emailProcessingQueue });
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the broadcaster grant itself invokable', () => {
    const { lambda, stack }                         = synthesize();
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush(broadcaster);

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn' });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
