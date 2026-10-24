import { CloudFormationClient }         from '@aws-sdk/client-cloudformation';
import { Route53Client }                from '@aws-sdk/client-route-53';
import { wrapHandler }                  from 'aws-custom-resources';

import * as env                         from '../handler-kit/config/config-env';
import { answerRequestWithBadConfig }   from '../handler-kit/custom-resource/custom-resource-bad-config-answer';
import { FailedRequestAnswerer }        from '../handler-kit/custom-resource/custom-resource-failed-request-answerer';
import { emitManualFinalize }           from '../handler-kit/custom-resource/custom-resource-manual-finalize';
import { readCustomResourceRequest }    from '../handler-kit/custom-resource/custom-resource-request-reader';
import { ParentStackStatus }            from '../handler-kit/custom-resource/parent-stack-status';
import { ExpectedFailure }              from '../handler-kit/errors/expected-failure';
import { LoggerBuffer }                 from '../handler-kit/logger-buffer';
import { withSmokeTest }                from '../handler-kit/with-smoke-test';

import { load }                         from './config';
import { StackHelpersRequestHandler }   from './stack-helpers-request-handler';
import { StackHelpersResolver }         from './stack-helpers-resolver';

const { config, error: configError } = env.tryLoad(load);
const route53                        = new Route53Client({});
const cloudFormation                 = new CloudFormationClient({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request = readCustomResourceRequest(event);

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  emitManualFinalize({ ...event, StackId: request.StackId }, { service: config.serviceName });

  const logger                = new LoggerBuffer(config.serviceName, config.logLevel);
  const requestHandler        = new StackHelpersRequestHandler(new StackHelpersResolver(route53, logger));
  const failedRequestAnswerer = new FailedRequestAnswerer(new ParentStackStatus(cloudFormation, logger), logger);

  try {
    return await requestHandler.handle(request);
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }

    const suppressedAnswer = await failedRequestAnswerer.answer(request, failure);
    if (suppressedAnswer) {
      return suppressedAnswer;
    }
    throw failure;
  }
}), env.check(load));
