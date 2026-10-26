/// <reference types="jest" />

/**
 * SesEventProcessorLambda: the names it hands the Go handler, the grants it requests for itself on
 * its tables, blob store and queues, the queue event it registers, and the websocket push wiring.
 * The statement each grant renders and the mapping the event renders are pinned by the resource and
 * the event that own them, not here.
 */

import { Template }                                                                         from 'aws-cdk-lib/assertions';

import type { IWebSocketBroadcastPublisher }                                                from '../../../contracts/websocket-push';
import { SesNotificationsQueueEvent }                                                       from '../../events/ses-notifications-queue-event';
import { SesEventProcessorLambda }                                                          from '../ses-event-processor-lambda';

import { expectGrantedOnceTo, fakeDataBlobStore, fakeDataTable, fakeQueue }                 from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                                from './lambda-wrapper-helpers';

jest.mock('../../events/ses-notifications-queue-event');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const itemTable                   = fakeDataTable('item-table');
  const changelogTable              = fakeDataTable('changelog-table');
  const mailFeedbackTable           = fakeDataTable('mail-feedback-table');
  const configTable                 = fakeDataTable('config-table');
  const blobStore                   = fakeDataBlobStore('blob-store');
  const auditEventsQueue            = fakeQueue('audit-events');
  const sesEventQueue               = fakeQueue('ses-events');
  const lambda                      = new SesEventProcessorLambda(stack, 'ses-event-processor', {
    itemTable,
    changelogTable,
    mailFeedbackTable,
    configTable,
    blobStore,
    auditEventsQueue,
    sesEventQueue,
    artifactResolver,
  });

  return { lambda, stack, itemTable, changelogTable, mailFeedbackTable, configTable, blobStore, auditEventsQueue, sesEventQueue };
}

describe('SesEventProcessorLambda', () => {
  beforeEach(() => {
    jest.mocked(SesNotificationsQueueEvent).mockClear();
  });

  it('passes the table names, the blob store name and the audit queue URL to the handler', () => {
    const { stack } = synthesize();

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({
      ITEM_TABLE_NAME:          'item-table',
      CHANGELOG_TABLE_NAME:     'changelog-table',
      MAIL_FEEDBACK_TABLE_NAME: 'mail-feedback-table',
      CONFIG_TABLE_NAME:        'config-table',
      BLOB_STORE_NAME:          'blob-store',
      AUDIT_EVENTS_QUEUE_URL:   'https://sqs.fake/audit-events',
    });
  });

  it('requests read-write on the item, changelog, mail-feedback and config tables for itself', () => {
    const { lambda, itemTable, changelogTable, mailFeedbackTable, configTable } = synthesize();

    expectGrantedOnceTo(itemTable.grantReadWrite, lambda);
    expectGrantedOnceTo(changelogTable.grantReadWrite, lambda);
    expectGrantedOnceTo(mailFeedbackTable.grantReadWrite, lambda);
    expectGrantedOnceTo(configTable.grantReadWrite, lambda);
  });

  it('requests email-blob write on the blob store for itself', () => {
    const { lambda, blobStore } = synthesize();

    expectGrantedOnceTo(blobStore.grantEmailBlobWrite, lambda);
  });

  it('requests send on the audit-events queue and consume on the SES-event queue for itself', () => {
    const { lambda, auditEventsQueue, sesEventQueue } = synthesize();

    expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
    expectGrantedOnceTo(sesEventQueue.grantConsume, lambda);
  });

  it('registers one queue event that delivers the SES-event queue to itself', () => {
    const { lambda, sesEventQueue } = synthesize();

    expect(SesNotificationsQueueEvent).toHaveBeenCalledTimes(1);
    expect(SesNotificationsQueueEvent).toHaveBeenCalledWith(lambda, 'ses-notifications-queue', { target: lambda, queue: sesEventQueue });
  });

  it('enableWebSocketPush sets WEBSOCKET_BROADCAST_FUNCTION_NAME and lets the broadcaster grant itself invokable', () => {
    const { lambda, stack }                         = synthesize();
    const broadcaster: IWebSocketBroadcastPublisher = { functionName: 'broadcast-fn', grantInvoke: jest.fn() };

    lambda.enableWebSocketPush(broadcaster);

    expect(onlyLambdaOf(Template.fromStack(stack)).environment).toMatchObject({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcast-fn' });
    expect(broadcaster.grantInvoke).toHaveBeenCalledWith(lambda);
  });
});
