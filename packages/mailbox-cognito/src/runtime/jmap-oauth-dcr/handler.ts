import { CognitoIdentityProviderClient }    from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient }                     from '@aws-sdk/client-lambda';
import { env, LoggerBuffer, withSmokeTest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { APIGatewayProxyEventV2 }      from 'aws-lambda';

import { IdentityProvisionerClient }        from '../shared/identity-provisioner-client';

import { ClientRegistration }               from './client-registration';
import { CognitoUserPoolClientManager }     from './cognito-client';
import { load }                             from './config';
import { RedirectUriPolicy }                from './redirect-uri';
import { RegistrationAnswers }              from './registration-answers';

const config = env.mustLoad(load);

const lambdaClient  = new LambdaClient({});
const cognitoClient = new CognitoIdentityProviderClient({});

const identityProvisioner = new IdentityProvisionerClient(config.identityProvisionerFunctionName, lambdaClient);
const cognito             = new CognitoUserPoolClientManager(cognitoClient);
const redirectUriPolicy   = new RedirectUriPolicy();

export const handler = withSmokeTest(async (event: APIGatewayProxyEventV2) => {
  const logger       = new LoggerBuffer(config.serviceName, config.logLevel);
  const registration = new ClientRegistration(identityProvisioner, cognito, config.userPoolId, redirectUriPolicy, logger);

  try {
    return await registration.register(event);
  } catch (failure) {
    logger.error('jmap_oauth_dcr_unhandled_error', { error: String(failure) });
    logger.flush();
    return RegistrationAnswers.internalError();
  }
}, env.check(load));
