import { wrapHandler } from 'aws-custom-resources';
import { Route53Client } from '@aws-sdk/client-route-53';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emitManualFinalize } from '../shared/manual-finalize';
import * as env from '../shared/env';
import { load } from './config';
import { StackHelpersResolver } from './stack-helpers-resolver';

const { config, error: configError } = env.tryLoad(load);
const resolver = new StackHelpersResolver(new Route53Client({}));

export const handler = withSmokeTest(wrapHandler(async (event) => {
  if (configError) {
    throw new Error(configError);
  }

  emitManualFinalize(event, { service: config.serviceName });

  // The resource creates nothing, so there is nothing to undo on Delete.
  if (event.RequestType === 'Delete') {
    return {};
  }

  return { Data: await resolver.resolve(event.ResourceProperties) };
}), env.check(load));
