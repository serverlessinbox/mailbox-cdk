import type { IArtifactResolver }                               from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                             from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                      from 'aws-cdk-lib/aws-iam';
import { Duration }                                             from 'aws-cdk-lib';
import { Construct }                                            from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushApi } from '../../contracts/websocket-push';
import type { IPatTable }                                       from '../tables/data-pat-table';
import type { IDataTable }                                      from '../tables/data-tables';
import { IWebSocketTable }                                      from '../tables/websocket-table';

/**
 * The connections table it queries and prunes, the WebSocket push API it posts to, the config, item and token tables it
 * reads to resolve rights, and the artifact resolver for its code. The caller creates the tables and the push API.
 */
export interface StateChangeFanoutLambdaProps {
  readonly connectionsTable: IWebSocketTable;
  readonly webSocketPushApi: IWebSocketPushApi;
  readonly configTable:      IDataTable;
  readonly itemTable:        IDataTable;
  readonly patTable:         IPatTable;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda that fans a state change out to the WebSocket connections and the push subscriptions that are owed it. */
export class StateChangeFanoutLambda extends GoLambda implements IWebSocketBroadcastPublisher {
  constructor(scope: Construct, id: string, props: StateChangeFanoutLambdaProps) {
    super(scope, id, {
      lambdaId:         'state-change-fanout',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(60),
      memorySize:       512,
      environment:      {
        CONNECTIONS_TABLE_NAME: props.connectionsTable.tableName,
        WEBSOCKET_API_ENDPOINT: props.webSocketPushApi.managementEndpoint,
        ITEM_TABLE_NAME:        props.itemTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        PAT_TABLE_NAME:         props.patTable.tableName,
      },
    });

    props.connectionsTable.grantBroadcast(this);
    props.connectionsTable.grantRemoveConnection(this);

    props.webSocketPushApi.grantManageConnections(this);

    props.configTable.grantRead(this);
    props.itemTable.grantRead(this);
    this.addToRolePolicy(
      new PolicyStatement({
        actions:    ['dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
        resources:  [props.itemTable.tableArn],
        conditions: {
          'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*#PUSH_SUB_OWNER#*', 'TENANT#*#PUSH_TENANT_COUNT'] },
        },
      }),
    );

    props.patTable.grantPatOwnerRead(this);
  }
}
