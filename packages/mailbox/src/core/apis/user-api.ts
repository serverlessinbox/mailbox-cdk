import type { IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { HttpLambdaAuthorizer }    from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpMethod }              from 'aws-cdk-lib/aws-apigatewayv2';
import { Construct }               from 'constructs';

import { AuthPolicyName }          from '../../contracts/auth-names';
import { AuthorizerLambda }        from '../../resources/lambdas/authorizer-lambda';
import { UserApiLambda }           from '../../resources/lambdas/user-api-lambda';
import type { IAuditEventsQueue }  from '../../resources/queues/audit-events-queue';
import type { IAuthKeyStoreTable } from '../../resources/tables/auth-key-store-table';
import type { IDataTable }         from '../../resources/tables/data-tables';

import type { ApiRoute, IApiArea } from './api-area';

/** Inputs of {@link UserApi}: the tables, queue and resolver its Lambda and authorizer use. */
export interface UserApiProps {
  readonly configTable:       IDataTable;
  readonly itemTable:         IDataTable;
  readonly auditEventsQueue:  IAuditEventsQueue;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly artifactResolver:  IArtifactResolver;
}

/**
 * The user area: the user-api Lambda behind its own authorizer, served as `POST /user/{proxy+}` on the
 * shared API. It authorizes with the same policy as the JMAP API.
 */
export class UserApi extends Construct implements IApiArea {
  /** The area's single route, `POST /user/{proxy+}`. */
  public readonly routes: ApiRoute[];

  constructor(scope: Construct, id: string, props: UserApiProps) {
    super(scope, id);

    const handler = new UserApiLambda(this, 'handler', {
      configTable:      props.configTable,
      itemTable:        props.itemTable,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    const authorizerLambda = new AuthorizerLambda(this, 'lambda-authorizer', {
      authKeyStoreTable: props.authKeyStoreTable,
      configTable:       props.configTable,
      artifactResolver:  props.artifactResolver,
      authPolicyName:    AuthPolicyName.JMAP_API,
      serviceName:       'authorizer-user-api',
      pipeline:          'jmap',
    });

    this.routes = [{
      path:          '/user/{proxy+}',
      methods:       [HttpMethod.POST],
      integrationId: 'user-api',
      handler,
      authorizer:    new HttpLambdaAuthorizer('user-authorizer', authorizerLambda),
    }];
  }
}
