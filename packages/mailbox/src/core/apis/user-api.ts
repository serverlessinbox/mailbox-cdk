import type { IArtifactResolver }                      from '@serverlessinbox/artifact-registry-cdk';
import { HttpLambdaAuthorizer }                        from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpMethod }                                  from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration }                                    from 'aws-cdk-lib';
import { Construct }                                   from 'constructs';

import { AuthPolicyName }                              from '../../contracts/auth-names';
import type { IStateChangeFanout, IStateChangeSource } from '../../contracts/state-change-fanout';
import type { IDataBlobStore }                         from '../../resources/buckets/data-blob-store';
import { AuthorizerLambda }                            from '../../resources/lambdas/authorizer-lambda';
import type { IMailImportRunner }                      from '../../resources/lambdas/mail-import-runner-lambda';
import { UserApiLambda }                               from '../../resources/lambdas/user-api-lambda';
import type { IAuditEventsQueue }                      from '../../resources/queues/audit-events-queue';
import type { IImportJobsQueue }                       from '../../resources/queues/import-jobs-queue';
import type { IAuthKeyStoreTable }                     from '../../resources/tables/auth-key-store-table';
import type { IPatTable }                              from '../../resources/tables/data-pat-table';
import type { IDataTable }                             from '../../resources/tables/data-tables';
import type { ScopeMap }                               from '../auth/jmap-scopes';

import type { ApiRoute, IApiArea }                     from './api-area';

/** Inputs of {@link UserApi}: the tables, queues, runner, resolver and OAuth scope map its Lambda and authorizer use. */
export interface UserApiProps {
  readonly configTable:         IDataTable;
  readonly itemTable:           IDataTable;
  readonly auditEventsQueue:    IAuditEventsQueue;
  readonly authKeyStoreTable:   IAuthKeyStoreTable;
  readonly importJobsQueue:     IImportJobsQueue;
  readonly mailImportRunner:    IMailImportRunner;
  readonly artifactResolver:    IArtifactResolver;
  readonly patTable:            IPatTable;
  readonly blobStore:           IDataBlobStore;
  readonly changelogTable:      IDataTable;
  readonly systemSenderAddress: string;
  readonly scopeMap:            ScopeMap;
}

/**
 * The user area: the user-api Lambda behind its own authorizer, served as `POST /user/{proxy+}` on the
 * shared API. It authorizes with the same policy as the JMAP API.
 */
export class UserApi extends Construct implements IApiArea {
  /** The area's single route, `POST /user/{proxy+}`. */
  public readonly routes: ApiRoute[];

  private readonly stateChangeSource: IStateChangeSource;

  constructor(scope: Construct, id: string, props: UserApiProps) {
    super(scope, id);

    const handler          = new UserApiLambda(this, 'handler', {
      configTable:         props.configTable,
      itemTable:           props.itemTable,
      auditEventsQueue:    props.auditEventsQueue,
      authKeyStoreTable:   props.authKeyStoreTable,
      importJobsQueue:     props.importJobsQueue,
      mailImportRunner:    props.mailImportRunner,
      artifactResolver:    props.artifactResolver,
      patTable:            props.patTable,
      blobStore:           props.blobStore,
      changelogTable:      props.changelogTable,
      systemSenderAddress: props.systemSenderAddress,
      scopeMap:            props.scopeMap,
    });
    this.stateChangeSource = handler;

    const authorizerLambda = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable:    props.authKeyStoreTable,
      configTable:          props.configTable,
      artifactResolver:     props.artifactResolver,
      authPolicyName:       AuthPolicyName.JMAP_API,
      scopeMap:             props.scopeMap,
      serviceName:          'authorizer-user-api',
      pipeline:             'jmap',
      personalAccessTokens: { patTable: props.patTable, auditEventsQueue: props.auditEventsQueue },
    });

    this.routes = [{
      path:          '/user/{proxy+}',
      methods:       [HttpMethod.POST],
      integrationId: 'user-api',
      handler,
      authorizer: new HttpLambdaAuthorizer('user-authorizer', authorizerLambda, { resultsCacheTtl: Duration.minutes(5) }),
    }];
  }

  /** Lets the handler Lambda publish through state-change fan-out to connected WebSocket clients. */
  public enableStateChangeFanout(stateChangeFanout: IStateChangeFanout): void {
    this.stateChangeSource.enableStateChangeFanout(stateChangeFanout);
  }
}
