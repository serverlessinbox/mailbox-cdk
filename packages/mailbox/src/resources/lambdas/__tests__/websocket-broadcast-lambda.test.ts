/// <reference types="jest" />

/**
 * WebSocketBroadcastLambda wiring: the Query grant on the connections table and its index, the remove grant it takes for stale-connection cleanup, the endpoint it reads from the
 * push API, and the grantManageConnections call with the function itself as grantee. The push API is a jest fake,
 * so this suite pins only what the broadcast Lambda passes to it.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import type { IGrantable }                      from 'aws-cdk-lib/aws-iam';
import type * as cdk                            from 'aws-cdk-lib';

import type { IWebSocketPushApi }               from '../../../contracts/websocket-push';
import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { DataTable }                            from '../../tables/data-tables';
import { WebSocketTable }                       from '../../tables/websocket-table';
import { WebSocketBroadcastLambda }             from '../websocket-broadcast-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

const FAKE_MANAGEMENT_ENDPOINT = 'https://fake.execute-api.us-west-2.amazonaws.com/prod';

interface PolicyResource {
  readonly Type:        string;
  readonly Properties?: { readonly PolicyDocument?: { readonly Statement?: unknown[] } };
}

function statementsOnTable(template: Template, tableId: string): unknown[] {
  const resources = template.toJSON().Resources as Record<string, PolicyResource>;
  return Object.values(resources)
    .filter((resource) => resource.Type === 'AWS::IAM::Policy')
    .flatMap((resource) => resource.Properties?.PolicyDocument?.Statement ?? [])
    .filter((statement) => JSON.stringify(statement).includes(tableId));
}

describe('WebSocketBroadcastLambda connections-table and push-API wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let tableId: string;
  let grantManageConnections: jest.Mock<void, [IGrantable]>;
  let broadcastLambda: WebSocketBroadcastLambda;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable      = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const connectionsTable = new WebSocketTable(stack, 'websocket-table');
    tableId                = stack.getLogicalId(defaultCfnResource(connectionsTable));

    grantManageConnections                    = jest.fn<void, [IGrantable]>();
    const webSocketPushApi: IWebSocketPushApi = {
      managementEndpoint: FAKE_MANAGEMENT_ENDPOINT,
      grantManageConnections,
    };

    broadcastLambda = new WebSocketBroadcastLambda(stack, 'websocket-broadcast', {
      connectionsTable,
      configTable,
      webSocketPushApi,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('grants exactly two statements on the connections table: Query on the table and its index, and Query and DeleteItem on the table', () => {
    expect(statementsOnTable(template, tableId)).toEqual([
      {
        Action:   'dynamodb:Query',
        Effect:   'Allow',
        Resource: [
          { 'Fn::GetAtt': [tableId, 'Arn'] },
          { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
        ],
      },
      {
        Action:   ['dynamodb:Query', 'dynamodb:DeleteItem'],
        Effect:   'Allow',
        Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
      },
    ]);
  });

  it('calls grantManageConnections on the push API once, with the function itself as the grantee', () => {
    expect(grantManageConnections).toHaveBeenCalledTimes(1);
    expect(grantManageConnections).toHaveBeenCalledWith(broadcastLambda);
  });

  it('sets WEBSOCKET_API_ENDPOINT from the push API managementEndpoint', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WEBSOCKET_API_ENDPOINT: FAKE_MANAGEMENT_ENDPOINT,
        }),
      },
    });
  });
});
