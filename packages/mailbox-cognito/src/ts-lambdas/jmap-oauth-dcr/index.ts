import { LambdaClient } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { env, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { CognitoUserPoolClientManager } from './cognito-client';
import { load } from './config';
import { IdentityProvisionerClient } from './identity-provisioner-client';
import { createHandler } from './handler';

const config = env.mustLoad(load);

const lambdaClient = new LambdaClient({});
const cognitoClient = new CognitoIdentityProviderClient({});

const identityProvisioner = new IdentityProvisionerClient(
  config.identityProvisionerFunctionName,
  lambdaClient,
);

const cognitoManager = new CognitoUserPoolClientManager(cognitoClient);

const baseHandler = createHandler({
  identityProvisioner,
  cognito: cognitoManager,
  userPoolId: config.userPoolId,
  serviceName: config.serviceName,
  logLevel: config.logLevel,
});

export const handler = withSmokeTest(baseHandler, env.check(load));
