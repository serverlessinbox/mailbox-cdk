import { wrapHandler } from 'aws-custom-resources';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  answerRequestWithBadConfig,
  emitManualFinalize,
  env,
  ExpectedFailure,
  LoggerBuffer,
  withSmokeTest,
  type CustomResourceRequest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { BootstrapUserAnswers } from './bootstrap-user-answers';
import { BootstrapUserRequestHandler } from './bootstrap-user-request-handler';
import { load } from './config';
import { UserEnsurer } from './ensure-user';

const { config, error: configError } = env.tryLoad(load);
const cognito = new CognitoIdentityProviderClient({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request: CustomResourceRequest = event;

  if (configError) {
    const badConfigAnswer = answerRequestWithBadConfig(request, configError);
    return BootstrapUserAnswers.withPasswordMarker(badConfigAnswer.PhysicalResourceId);
  }

  emitManualFinalize(event, { service: config.serviceName });

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler = new BootstrapUserRequestHandler(new UserEnsurer(cognito), logger);

  try {
    return await requestHandler.handle(request);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }
    return await requestHandler.answerFailure(request, failure);
  }
}), env.check(load));
