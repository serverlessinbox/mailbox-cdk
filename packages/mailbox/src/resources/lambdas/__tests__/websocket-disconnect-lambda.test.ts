/// <reference types="jest" />

/**
 * WebSocketDisconnectLambda: the table names it hands the Go handler and the grants it requests for
 * itself on the connections and config tables. The statement each grant renders is pinned by the
 * table that owns it.
 */

import { Template }                                                from 'aws-cdk-lib/assertions';

import { WebSocketDisconnectLambda }                               from '../websocket-disconnect-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakeWebSocketTable }  from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                       from './lambda-wrapper-helpers';

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const connectionsTable            = fakeWebSocketTable('connections-table');
  const configTable                 = fakeDataTable('config-table');
  const lambda                      = new WebSocketDisconnectLambda(stack, 'websocket-disconnect', { connectionsTable, configTable, artifactResolver });

  return { lambda, connectionsTable, configTable, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('WebSocketDisconnectLambda', () => {
  it('passes the connections and config table names to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      CONNECTIONS_TABLE_NAME: 'connections-table',
      CONFIG_TABLE_NAME:      'config-table',
    });
  });

  it('requests remove-connection on the connections table for itself', () => {
    const { lambda, connectionsTable } = synthesize();

    expectGrantedOnceTo(connectionsTable.grantRemoveConnection, lambda);
  });

  it('requests read on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
  });
});
