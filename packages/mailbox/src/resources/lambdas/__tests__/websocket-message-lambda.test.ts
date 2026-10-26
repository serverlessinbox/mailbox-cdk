/// <reference types="jest" />

/**
 * WebSocketMessageLambda: the environment it hands the Go handler, including the subscription limit
 * as a string and the endpoint it reads from the push API, and the grants it requests for itself
 * on the connections, config and item tables and on the push API. The statement each grant renders
 * is pinned by the resource that owns it. The push API is a fake, so this suite pins only what the
 * message Lambda passes to it.
 */

import { Template }                                                                  from 'aws-cdk-lib/assertions';

import type { IWebSocketPushApi }                                                    from '../../../contracts/websocket-push';
import { WebSocketMessageLambda }                                                    from '../websocket-message-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakeWebSocketTable }                    from './lambda-wrapper-fakes';
import type { GrantSpy }                                                             from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                         from './lambda-wrapper-helpers';

const FAKE_MANAGEMENT_ENDPOINT = 'https://fake.execute-api.us-west-2.amazonaws.com/prod';

function synthesize() {
  const { stack, artifactResolver }         = arrangeWrapperStack();
  const connectionsTable                    = fakeWebSocketTable('connections-table');
  const configTable                         = fakeDataTable('config-table');
  const itemTable                           = fakeDataTable('item-table');
  const grantManageConnections              = jest.fn<void, Parameters<GrantSpy>>();
  const webSocketPushApi: IWebSocketPushApi = { managementEndpoint: FAKE_MANAGEMENT_ENDPOINT, grantManageConnections };
  const lambda                              = new WebSocketMessageLambda(stack, 'websocket-message', {
    connectionsTable,
    configTable,
    itemTable,
    maxSubscriptions: 17,
    webSocketPushApi,
    artifactResolver,
  });

  return { lambda, connectionsTable, configTable, itemTable, grantManageConnections, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('WebSocketMessageLambda', () => {
  it('passes the table names, the subscription limit and the push API management endpoint to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      CONNECTIONS_TABLE_NAME: 'connections-table',
      CONFIG_TABLE_NAME:      'config-table',
      ITEM_TABLE_NAME:        'item-table',
      MAX_SUBSCRIPTIONS:      '17',
      WEBSOCKET_API_ENDPOINT: FAKE_MANAGEMENT_ENDPOINT,
    });
  });

  it('requests store-connection on the connections table for itself', () => {
    const { lambda, connectionsTable } = synthesize();

    expectGrantedOnceTo(connectionsTable.grantStoreConnection, lambda);
  });

  it('requests read on the config and item tables for itself', () => {
    const { lambda, configTable, itemTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
    expectGrantedOnceTo(itemTable.grantRead, lambda);
  });

  it('requests manage-connections on the push API for itself', () => {
    const { lambda, grantManageConnections } = synthesize();

    expectGrantedOnceTo(grantManageConnections, lambda);
  });
});
