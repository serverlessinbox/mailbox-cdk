import { CognitoIdentityProviderClient }    from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient }                     from '@aws-sdk/client-lambda';
import { SQSClient }                        from '@aws-sdk/client-sqs';
import { SqsAuditSink, wrapService }        from '@serverlessinbox/mailbox-addon-sdk';
import { env, LoggerBuffer, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { IdentityProvisionerClient }        from '../../runtime/shared/identity-provisioner-client';

import { load }                             from './config';
import { IdpUsersServiceRuntime }           from './generated/idp_users_service';
import { IdpUserMapper }                    from './idp-user-mapper';
import { CognitoIdpUsersService }           from './idp-users.service';
import { IdpUsersRequestValidator }         from './idp-users.validation';

const config = env.mustLoad(load);

const cognitoClient = new CognitoIdentityProviderClient({});
const lambdaClient  = new LambdaClient({});
const sqsClient     = new SQSClient({});

const logger = new LoggerBuffer(config.serviceName, config.logLevel);

const service = new CognitoIdpUsersService(cognitoClient, config.userPoolId, {
  identityProvisioner: new IdentityProvisionerClient(config.identityProvisionerFunctionName, lambdaClient),
  userMapper:          new IdpUserMapper(),
  validator:           new IdpUsersRequestValidator(),
  adminGroups:         config.adminGroups,
  logger,
});

export const handler = withSmokeTest(wrapService(IdpUsersServiceRuntime, service, new SqsAuditSink(sqsClient, config.auditEventsQueueUrl), logger), env.check(load));
