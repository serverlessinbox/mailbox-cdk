import { Route53Client }              from '@aws-sdk/client-route-53';
import { wrapHandler }                from 'aws-custom-resources';

import * as env                       from '../handler-kit/config/config-env';
import { answerRequestWithBadConfig } from '../handler-kit/custom-resource/custom-resource-bad-config-answer';
import { emitManualFinalize }         from '../handler-kit/custom-resource/custom-resource-manual-finalize';
import { readCustomResourceRequest }  from '../handler-kit/custom-resource/custom-resource-request-reader';
import { ExpectedFailure }            from '../handler-kit/errors/expected-failure';
import { LoggerBuffer }               from '../handler-kit/logger-buffer';
import { withSmokeTest }              from '../handler-kit/with-smoke-test';

import { load }                       from './config';
import { StackHelpersRequestHandler } from './stack-helpers-request-handler';
import { StackHelpersResolver }       from './stack-helpers-resolver';

const { config, error: configError } = env.tryLoad(load);
const route53                        = new Route53Client({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request = readCustomResourceRequest(event);

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  emitManualFinalize({ ...event, StackId: request.StackId }, { service: config.serviceName });

  const logger         = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler = new StackHelpersRequestHandler(new StackHelpersResolver(route53, logger));

  try {
    return await requestHandler.handle(request);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw failure;
  }
}), env.check(load));
