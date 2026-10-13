/**
 * Coverage for what the data override resolver config differs in from the shared base config: SERVICE_NAME is
 * optional and defaults to empty, so a template that does not set it still loads.
 */

import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('data-override-resolver config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  it('loads the service name when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'data-override-resolver';

    expect(env.tryLoad(load)).toEqual({
      config: { logLevel: 'info', serviceName: 'data-override-resolver' },
      error: undefined,
    });
  });

  it('defaults the service name to empty without reporting a problem', () => {
    expect(env.tryLoad(load)).toEqual({ config: { logLevel: 'error', serviceName: '' }, error: undefined });
  });
});
