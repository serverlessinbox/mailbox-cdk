import { wrapHandler } from 'aws-custom-resources';
import { Route53Client } from '@aws-sdk/client-route-53';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emitManualFinalize } from '../shared/manual-finalize';
import { answerRequestWithBadConfig } from '../shared/bad-config-answer';
import { toStackId } from '../shared/custom-resource-identifiers';
import type { CustomResourceRequest } from '../shared/custom-resource-request';
import * as env from '../shared/env';
import { ExpectedFailure } from '../shared/expected-failure';
import { LoggerBuffer } from '../shared/logger-buffer';
import { load } from './config';
import { StackHelpersResolver } from './stack-helpers-resolver';

const { config, error: configError } = env.tryLoad(load);
const route53 = new Route53Client({});

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

  const logger = new LoggerBuffer(config.serviceName, config.logLevel);
  const resolver = new StackHelpersResolver(route53, logger);

  try {
    return { Data: await resolver.resolve(event.ResourceProperties) };
  } catch (failure) {
    if (!(failure instanceof ExpectedFailure)) {
      logger.flush();
    }
    throw failure;
  }
}), env.check(load));
