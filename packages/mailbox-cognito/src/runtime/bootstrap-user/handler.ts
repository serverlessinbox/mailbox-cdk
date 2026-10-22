import { CloudFormationClient }          from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  answerRequestWithBadConfig,
  emitManualFinalize,
  env,
  ExpectedFailure,
  LoggerBuffer,
  ParentStackStatus,
  readCustomResourceRequest,
  withSmokeTest,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { wrapHandler }                 from 'aws-custom-resources';

import { BootstrapUserAnswers }        from './bootstrap-user-answers';
import { BootstrapUserRequestHandler } from './bootstrap-user-request-handler';
import { load }                        from './config';
import { UserEnsurer }                 from './ensure-user';

const { config, error: configError } = env.tryLoad(load);
const cognito                        = new CognitoIdentityProviderClient({});
const cloudFormation                 = new CloudFormationClient({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request = readCustomResourceRequest(event);

  if (configError) {
    const badConfigAnswer = answerRequestWithBadConfig(request, configError);
    return BootstrapUserAnswers.withPasswordMarker(badConfigAnswer.PhysicalResourceId);
  }

  emitManualFinalize({ ...event, StackId: request.StackId }, { service: config.serviceName });

  const logger         = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler = new BootstrapUserRequestHandler(new UserEnsurer(cognito, logger), new ParentStackStatus(cloudFormation, logger), logger);

  try {
    return await requestHandler.handle(request);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }
    return await requestHandler.answerFailure(request, failure);
  }
}), env.check(load));
