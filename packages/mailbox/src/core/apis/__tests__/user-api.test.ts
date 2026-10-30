/// <reference types="jest" />

/**
 * UserApi tests: the user area serves `POST /user/{proxy+}` on the shared API, behind its own authorizer
 * that uses the JMAP API's policy and has no principal lookup. A route that loses its authorizer, or gets
 * the wrong policy, stays green in tsc and synth, so these assertions are the only guard. The stage carries
 * no access log, so a request body or header cannot be written to the logs, and no statement the user area's
 * stack renders grants the connection private key.
 */

import { Match, Template }                             from 'aws-cdk-lib/assertions';
import type * as cdk                                   from 'aws-cdk-lib';

import { resourcesOfType }                             from '../../../__tests__/iam-test-helpers';
import { fakeMailImportRunner }                        from '../../../resources/lambdas/__tests__/lambda-wrapper-fakes';
import { ImportJobsQueue }                             from '../../../resources/queues/import-jobs-queue';
import { Permission }                                  from '../../auth/jmap-scopes';
import { ApiGateway }                                  from '../api-gateway';
import { UserApi }                                     from '../user-api';

import {
  authorizerOfRoute,
  newAdminApiProps,
  newApiStack,
  routeOf,
} from './apis-helpers';

describe('UserApi', () => {
  let stack: cdk.Stack;
  let gateway: ApiGateway;

  function userApiProps() {
    const { configTable, itemTable, auditEventsQueue, authKeyStoreTable, artifactResolver } = newAdminApiProps(stack);
    const importJobsQueue  = new ImportJobsQueue(stack, 'import-jobs-queue', { encryption: { kind: 'aws-managed' } });
    const mailImportRunner = fakeMailImportRunner('mail-import-runner');

    const scopeMap = { 'mail-reader': [Permission.MAIL_READ] };

    return { configTable, itemTable, auditEventsQueue, authKeyStoreTable, importJobsQueue, mailImportRunner, artifactResolver, scopeMap };
  }

  function mountedUserApi(): UserApi {
    const sut = new UserApi(stack, 'user-api', userApiProps());

    gateway.mount(sut);

    return sut;
  }

  beforeEach(() => {
    stack   = newApiStack();
    gateway = new ApiGateway(stack, 'admin-api', {});
  });

  it('creates its handler Lambda and authorizer Lambda under itself', () => {
    const sut = new UserApi(stack, 'user-api', userApiProps());

    expect(sut.node.tryFindChild('handler')).toBeDefined();
    expect(sut.node.tryFindChild('lambda-authorizer')).toBeDefined();
  });

  it('lists the user route as its only route', () => {
    const sut = new UserApi(stack, 'user-api', userApiProps());

    expect(sut.routes.map((route) => route.path)).toEqual(['/user/{proxy+}']);
  });

  it('mounts POST /user/{proxy+}, served on the shared API behind a Lambda authorizer', () => {
    mountedUserApi();

    const template = Template.fromStack(stack);
    expect(routeOf(template, 'POST /user/{proxy+}').AuthorizationType).toBe('CUSTOM');
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
  });

  it('guards the user route with an authorizer that uses the JMAP API policy and no principal lookup', () => {
    mountedUserApi();

    const { functionEnvironment } = authorizerOfRoute(Template.fromStack(stack), 'POST /user/{proxy+}');

    expect(functionEnvironment).toMatchObject({ AUTH_POLICY_NAME: 'JMAP_API', PRINCIPAL_LOOKUP: 'off' });
  });

  it('gives the API stage no access log, so no request body or header is written to the logs', () => {
    mountedUserApi();

    const stages = resourcesOfType<{ readonly AccessLogSettings?: unknown }>(Template.fromStack(stack), 'AWS::ApiGatewayV2::Stage');
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect(stage.AccessLogSettings).toBeUndefined();
    }
  });

  it('renders no statement that grants the connection private key to the user area', () => {
    mountedUserApi();

    const privateKeyStatements = Template.fromStack(stack).findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([Match.objectLike({
            Condition: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['connection-key-private'] } },
          })]),
        },
      },
    });
    expect(Object.keys(privateKeyStatements)).toHaveLength(0);
  });
});
