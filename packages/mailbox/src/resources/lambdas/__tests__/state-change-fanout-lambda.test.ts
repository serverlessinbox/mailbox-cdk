/// <reference types="jest" />

/**
 * StateChangeFanoutLambda: the environment it hands the Go handler and the grants it requests for itself. The first
 * suite checks the requested grants on spies. The second renders the statements those grants produce on the fan-out's
 * own role, using real tables, so a grant that widens (a write on the token table, a scan of the item table) fails here.
 * The third suite renders the invoke grant the fan-out hands to its callers, on the caller's role.
 */

import { actionsOf }                                                            from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }                                             from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Capture, Match, Template }                                             from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                                                 from 'aws-cdk-lib/aws-dynamodb';
import * as iam                                                                 from 'aws-cdk-lib/aws-iam';

import type { IWebSocketPushApi }                                               from '../../../contracts/websocket-push';
import { defaultCfnResource }                                                   from '../../../utils/cfn-resource';
import { DataPatTable }                                                         from '../../tables/data-pat-table';
import { DataTable }                                                            from '../../tables/data-tables';
import { StateChangeFanoutLambda }                                              from '../state-change-fanout-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakePatTable, fakeWebSocketTable } from './lambda-wrapper-fakes';
import type { GrantSpy }                                                        from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                    from './lambda-wrapper-helpers';

const FAKE_MANAGEMENT_ENDPOINT = 'https://fake.execute-api.us-west-2.amazonaws.com/prod';

function synthesize() {
  const { stack, artifactResolver }         = arrangeWrapperStack();
  const connectionsTable                    = fakeWebSocketTable('connections-table');
  const configTable                         = fakeDataTable('config-table');
  const itemTable                           = fakeDataTable('item-table');
  const patTable                            = fakePatTable('pat-table');
  const grantManageConnections              = jest.fn<void, Parameters<GrantSpy>>();
  const webSocketPushApi: IWebSocketPushApi = { managementEndpoint: FAKE_MANAGEMENT_ENDPOINT, grantManageConnections };
  const lambda                              = new StateChangeFanoutLambda(stack, 'state-change-fanout', {
    connectionsTable,
    webSocketPushApi,
    configTable,
    itemTable,
    patTable,
    artifactResolver,
  });

  return { lambda, connectionsTable, configTable, itemTable, patTable, grantManageConnections, ...onlyLambdaOf(Template.fromStack(stack)) };
}

/** The same fan-out over real tables: the statements of its role are the ones the owning resources render. */
function synthesizeWithRealTables() {
  const { stack, artifactResolver }         = arrangeWrapperStack();
  const keyedTable                          = (id: string) => new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } });
  const patTableResource                    = keyedTable('pat-table');
  const itemTableResource                   = keyedTable('item-table');
  const webSocketPushApi: IWebSocketPushApi = { managementEndpoint: FAKE_MANAGEMENT_ENDPOINT, grantManageConnections: jest.fn() };
  new StateChangeFanoutLambda(stack, 'state-change-fanout', {
    connectionsTable: fakeWebSocketTable('connections-table'),
    webSocketPushApi,
    configTable: new DataTable(keyedTable('config-table')),
    itemTable:   new DataTable(itemTableResource),
    patTable:    new DataPatTable(patTableResource),
    artifactResolver,
  });

  const patTableArn  = { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(patTableResource)), 'Arn'] };
  const itemTableArn = { 'Fn::GetAtt': [stack.getLogicalId(defaultCfnResource(itemTableResource)), 'Arn'] };

  return { ...onlyLambdaOf(Template.fromStack(stack)), patTableArn, itemTableArn };
}

function statementsOnResource(statements: PolicyStatementJson[], resource: unknown): PolicyStatementJson[] {
  return statements.filter((statement) => JSON.stringify(statement.Resource) === JSON.stringify(resource));
}

describe('StateChangeFanoutLambda', () => {
  it('passes the connections, config, item and token table names and the push API endpoint to the handler', () => {
    expect(synthesize().environment).toMatchObject({
      CONNECTIONS_TABLE_NAME: 'connections-table',
      CONFIG_TABLE_NAME:      'config-table',
      ITEM_TABLE_NAME:        'item-table',
      PAT_TABLE_NAME:         'pat-table',
      WEBSOCKET_API_ENDPOINT: FAKE_MANAGEMENT_ENDPOINT,
    });
  });

  it('requests broadcast and connection removal on the connections table for itself', () => {
    const { lambda, connectionsTable } = synthesize();

    expectGrantedOnceTo(connectionsTable.grantBroadcast, lambda);
    expectGrantedOnceTo(connectionsTable.grantRemoveConnection, lambda);
  });

  it('requests manage-connections on the push API for itself', () => {
    const { lambda, grantManageConnections } = synthesize();

    expectGrantedOnceTo(grantManageConnections, lambda);
  });

  it('requests read on the config and item tables for itself', () => {
    const { lambda, configTable, itemTable } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
    expectGrantedOnceTo(itemTable.grantRead, lambda);
  });

  it('requests owner-row read on the token table for itself', () => {
    const { lambda, patTable } = synthesize();

    expectGrantedOnceTo(patTable.grantPatOwnerRead, lambda);
  });
});

describe('StateChangeFanoutLambda grants as rendered on its role', () => {
  it('gives the token table GetItem only, on owner rows', () => {
    const { statements, patTableArn } = synthesizeWithRealTables();
    const patStatements               = statementsOnResource(statements, patTableArn);

    expect(patStatements.map(actionsOf)).toEqual([['dynamodb:GetItem']]);
    expect(patStatements[0].Condition).toEqual({ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*PAT_OWNER#*'] } });
  });

  it('gives the item table UpdateItem and DeleteItem through its table ARN only, on push owner and tenant-count rows', () => {
    const { statements, itemTableArn } = synthesizeWithRealTables();
    const itemWriteStatements          = statementsOnResource(statements, itemTableArn);

    expect(itemWriteStatements).toEqual([
      {
        Action:    ['dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        Effect:    'Allow',
        Resource:  itemTableArn,
        Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*#PUSH_SUB_OWNER#*', 'TENANT#*#PUSH_TENANT_COUNT'] } },
      },
    ]);
  });

  it('gives no UpdateItem or DeleteItem without the LeadingKeys condition', () => {
    const { statements } = synthesizeWithRealTables();
    const unscopedWrites = statements.filter((statement) => {
      const writesItems = actionsOf(statement).some((action) => action === 'dynamodb:UpdateItem' || action === 'dynamodb:DeleteItem');
      return writesItems && statement.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys'] === undefined;
    });

    expect(unscopedWrites).toEqual([]);
  });

  it('gives no table a scan or a put', () => {
    const { statements } = synthesizeWithRealTables();
    const dynamoActions  = statements.flatMap(actionsOf).filter((action) => action.startsWith('dynamodb:'));

    expect(dynamoActions).not.toContain('dynamodb:Scan');
    expect(dynamoActions).not.toContain('dynamodb:PutItem');
  });

  it('gives the function the logical id of its own construct path, not the one it had before the rename', () => {
    const { logicalId } = synthesizeWithRealTables();

    expect(logicalId).toBe('statechangefanout0EE4C8B1');
  });
});

describe('StateChangeFanoutLambda.grantInvoke', () => {
  it('renders lambda:InvokeFunction on the function ARN in the grantee role', () => {
    const { stack, artifactResolver } = arrangeWrapperStack();
    const lambda                      = new StateChangeFanoutLambda(stack, 'state-change-fanout', {
      connectionsTable: fakeWebSocketTable('connections-table'),
      webSocketPushApi: { managementEndpoint: FAKE_MANAGEMENT_ENDPOINT, grantManageConnections: jest.fn() },
      configTable:      fakeDataTable('config-table'),
      itemTable:        fakeDataTable('item-table'),
      patTable:         fakePatTable('pat-table'),
      artifactResolver,
    });
    const role                        = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

    lambda.grantInvoke(role);

    const functionId = new Capture();
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      Roles:          [{ Ref: stack.getLogicalId(defaultCfnResource(role)) }],
      PolicyDocument: {
        Statement: [Match.objectLike({ Action: 'lambda:InvokeFunction', Resource: Match.arrayWith([{ 'Fn::GetAtt': [functionId, 'Arn'] }]) })],
      },
    });
    expect(stack.resolve(lambda.functionName)).toEqual({ Ref: functionId.asString() });
  });
});
