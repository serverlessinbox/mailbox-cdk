/// <reference types="jest" />

/**
 * WebSocketMessageLambda wiring: the GetItem and PutItem grant on the connections table, the endpoint it reads from the
 * push API, and the grantManageConnections call with the function itself as grantee. The push API is a jest fake,
 * so this suite pins only what the message Lambda passes to it.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import type { IGrantable }                      from 'aws-cdk-lib/aws-iam';
import type * as cdk                            from 'aws-cdk-lib';

import type { IWebSocketPushApi }               from '../../../contracts/websocket-push';
import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { DataTable }                            from '../../tables/data-tables';
import { WebSocketTable }                       from '../../tables/websocket-table';
import { WebSocketMessageLambda }               from '../websocket-message-lambda';

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

describe('WebSocketMessageLambda connections-table and push-API wiring', () => {
  let stack: cdk.Stack;
  let template: Template;
  let tableId: string;
  let grantManageConnections: jest.Mock<void, [IGrantable]>;
  let messageLambda: WebSocketMessageLambda;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable      = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const itemTable        = new DataTable(new Table(stack, 'item-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const connectionsTable = new WebSocketTable(stack, 'websocket-table');
    tableId                = stack.getLogicalId(defaultCfnResource(connectionsTable));

    grantManageConnections                    = jest.fn<void, [IGrantable]>();
    const webSocketPushApi: IWebSocketPushApi = {
      managementEndpoint: FAKE_MANAGEMENT_ENDPOINT,
      grantManageConnections,
    };

    messageLambda = new WebSocketMessageLambda(stack, 'websocket-message', {
      connectionsTable,
      configTable,
      itemTable,
      maxSubscriptions: 10,
      webSocketPushApi,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('grants exactly one statement on the connections table: GetItem and PutItem on the table, no index', () => {
    expect(statementsOnTable(template, tableId)).toEqual([
      {
        Action:   ['dynamodb:GetItem', 'dynamodb:PutItem'],
        Effect:   'Allow',
        Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
      },
    ]);
  });

  it('calls grantManageConnections on the push API once, with the function itself as the grantee', () => {
    expect(grantManageConnections).toHaveBeenCalledTimes(1);
    expect(grantManageConnections).toHaveBeenCalledWith(messageLambda);
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
