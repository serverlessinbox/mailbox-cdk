/// <reference types="jest" />

/**
 * WebSocketConnectLambda grants the read-write actions on the connections table and its index, and nothing else.
 */

import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                 from 'aws-cdk-lib/aws-dynamodb';
import type * as cdk                            from 'aws-cdk-lib';

import { defaultCfnResource }                   from '../../../utils/cfn-resource';
import { DataTable }                            from '../../tables/data-tables';
import { WebSocketTable }                       from '../../tables/websocket-table';
import { WebSocketConnectLambda }               from '../websocket-connect-lambda';

import { arrangeWrapperStack }                  from './lambda-wrapper-helpers';

describe('WebSocketConnectLambda connections-table grant', () => {
  let stack: cdk.Stack;
  let template: Template;
  let tableId: string;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    const configTable      = new DataTable(new Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
    }));
    const connectionsTable = new WebSocketTable(stack, 'websocket-table');
    tableId                = stack.getLogicalId(defaultCfnResource(connectionsTable));

    new WebSocketConnectLambda(stack, 'websocket-connect', {
      connectionsTable,
      configTable,
      artifactResolver: arrangement.artifactResolver,
    });

    template = Template.fromStack(stack);
  });

  it('grants exactly the read-write actions, Allow, on the connections table + index resources', () => {
    const expectedResource = [
      { 'Fn::GetAtt': [tableId, 'Arn'] },
      { 'Fn::Join': ['', [{ 'Fn::GetAtt': [tableId, 'Arn'] }, '/index/*']] },
    ];

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectEquals({
            Action:   Match.arrayEquals(['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem']),
            Effect:   'Allow',
            Resource: expectedResource,
          }),
        ]),
      },
    });
  });
});
