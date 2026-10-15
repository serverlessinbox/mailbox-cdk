import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { ApiGatewayV2EventLike } from '@serverlessinbox/mailbox-admin-api';
import { env, LoggerBuffer, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { IdentityProvisionerClient } from '../shared/identity-provisioner-client';
import { load } from './config';
import { IdpUserMapper } from './idp-user-mapper';
import { IdpUsersAdminApi } from './idp-users-admin-api';
import { CognitoIdpUsersService } from './idp-users.service';
import { IdpUsersRequestValidator } from './idp-users.validation';
import { SqsAuditEmitter } from './sqs-audit-emitter';

const config = env.mustLoad(load);

const cognitoClient = new CognitoIdentityProviderClient({});
const lambdaClient = new LambdaClient({});
const sqsClient = new SQSClient({});

const logger = new LoggerBuffer(undefined, config.logLevel);

const idpUsersAdminApi = new IdpUsersAdminApi(
  new CognitoIdpUsersService(cognitoClient, config.userPoolId, {
    identityProvisioner: new IdentityProvisionerClient(config.identityProvisionerFunctionName, lambdaClient),
    userMapper: new IdpUserMapper(),
    adminGroups: config.adminGroups,
    logger,
  }),
  new IdpUsersRequestValidator(),
  new SqsAuditEmitter(config.auditEventsQueueUrl, sqsClient),
  config.adminGroups,
  config.userGroups,
);

export const handler = withSmokeTest((event: ApiGatewayV2EventLike) => idpUsersAdminApi.handle(event), env.check(load));
