import { Route53Client }              from '@aws-sdk/client-route-53';
import { wrapHandler }                from 'aws-custom-resources';

import * as env                       from '../../runtime/handler-kit/config/config-env';
import { answerRequestWithBadConfig } from '../../runtime/handler-kit/custom-resource/custom-resource-bad-config-answer';
import { toStackId }                  from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { emitManualFinalize }         from '../../runtime/handler-kit/custom-resource/custom-resource-manual-finalize';
import type { CustomResourceRequest } from '../../runtime/handler-kit/custom-resource/custom-resource-request';
import { ExpectedFailure }            from '../../runtime/handler-kit/errors/expected-failure';
import { LoggerBuffer }               from '../shared/logger-buffer';
import { withSmokeTest }              from '../shared/with-smoke-test';

import { load }                       from './config';
import { StackHelpersResolver }       from './stack-helpers-resolver';

const { config, error: configError } = env.tryLoad(load);
const route53                        = new Route53Client({});

export const handler = withSmokeTest(wrapHandler(async (event) => {
  const request: CustomResourceRequest = event;

  if (configError) {
    return answerRequestWithBadConfig(request, configError);
  }

  emitManualFinalize({ ...event, StackId: toStackId(event.StackId) }, { service: config.serviceName });

  // The resource creates nothing, so there is nothing to undo on Delete.
  if (event.RequestType === 'Delete') {
    return {};
  }

  const logger   = new LoggerBuffer(config.serviceName, config.logLevel);
  const resolver = new StackHelpersResolver(route53, logger);

  try {
    return { Data: await resolver.resolve(event.ResourceProperties, toStackId(event.StackId)) };
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw failure;
  }
}), env.check(load));
