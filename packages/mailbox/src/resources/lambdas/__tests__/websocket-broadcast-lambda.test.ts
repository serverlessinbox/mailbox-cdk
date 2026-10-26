/// <reference types="jest" />

/**
 * WebSocketBroadcastLambda: the environment it hands the Go handler, including the endpoint it reads
 * from the push API, and the grants it requests for itself on the connections table, the config
 * table and the push API. The statement each grant renders is pinned by the resource that owns it.
 * The push API is a fake, so this suite pins only what the broadcast Lambda passes to it.
 */

import { Template }                                                                  from 'aws-cdk-lib/assertions';

import type { IWebSocketPushApi }                                                    from '../../../contracts/websocket-push';
import { WebSocketBroadcastLambda }                                                  from '../websocket-broadcast-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakeWebSocketTable }                    from './lambda-wrapper-fakes';
import type { GrantSpy }                                                             from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                         from './lambda-wrapper-helpers';

const FAKE_MANAGEMENT_ENDPOINT = 'https://fake.execute-api.us-west-2.amazonaws.com/prod';

function synthesize() {
  const { stack, artifactResolver }         = arrangeWrapperStack();
  const connectionsTable                    = fakeWebSocketTable('connections-table');
  const configTable                         = fakeDataTable('config-table');
  const grantManageConnections              = jest.fn<void, Parameters<GrantSpy>>();
  const webSocketPushApi: IWebSocketPushApi = { managementEndpoint: FAKE_MANAGEMENT_ENDPOINT, grantManageConnections };
  const lambda                              = new WebSocketBroadcastLambda(stack, 'websocket-broadcast', {
    connectionsTable,
    configTable,
    webSocketPushApi,
    artifactResolver,
  });

  return { lambda, connectionsTable, configTable, grantManageConnections, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('WebSocketBroadcastLambda', () => {
  it('passes the table names and the push API management endpoint to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      CONNECTIONS_TABLE_NAME: 'connections-table',
      CONFIG_TABLE_NAME:      'config-table',
      WEBSOCKET_API_ENDPOINT: FAKE_MANAGEMENT_ENDPOINT,
    });
  });

  it('requests broadcast and connection removal on the connections table for itself', () => {
    const { lambda, connectionsTable } = synthesize();

    expectGrantedOnceTo(connectionsTable.grantBroadcast, lambda);
    expectGrantedOnceTo(connectionsTable.grantRemoveConnection, lambda);
  });

  it('requests read on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
  });

  it('requests manage-connections on the push API for itself', () => {
    const { lambda, grantManageConnections } = synthesize();

    expectGrantedOnceTo(grantManageConnections, lambda);
  });
});
