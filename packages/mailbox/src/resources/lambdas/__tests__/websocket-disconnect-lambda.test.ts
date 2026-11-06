/// <reference types="jest" />

/**
 * WebSocketDisconnectLambda: the table name it hands the Go handler and the grant it requests for
 * itself on the connections table. The statement the grant renders is pinned by the table that owns it.
 */

import { Template }                                from 'aws-cdk-lib/assertions';

import { WebSocketDisconnectLambda }               from '../websocket-disconnect-lambda';

import { expectGrantedOnceTo, fakeWebSocketTable } from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }       from './lambda-wrapper-helpers';

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const connectionsTable            = fakeWebSocketTable('connections-table');
  const lambda                      = new WebSocketDisconnectLambda(stack, 'websocket-disconnect', { connectionsTable, artifactResolver });

  return { lambda, connectionsTable, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('WebSocketDisconnectLambda', () => {
  it('passes the connections table name to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      CONNECTIONS_TABLE_NAME: 'connections-table',
    });
  });

  it('requests remove-connection on the connections table for itself', () => {
    const { lambda, connectionsTable } = synthesize();

    expectGrantedOnceTo(connectionsTable.grantRemoveConnection, lambda);
  });
});
