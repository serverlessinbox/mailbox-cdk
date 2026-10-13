/**
 * Coverage for the data override resolver's config loader. LOG_LEVEL is parsed strictly: a mistyped
 * level must be reported, not silently replaced by the default, or the Lambda would stay degraded for
 * the life of the deployment. Both variables are optional with a default.
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

  it('loads both variables when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'data-override-resolver';

    expect(env.tryLoad(load)).toEqual({
      config: { logLevel: 'info', serviceName: 'data-override-resolver' },
      error: undefined,
    });
  });

  it('defaults the log level to error and the service name to empty', () => {
    expect(env.tryLoad(load).config).toEqual({ logLevel: 'error', serviceName: '' });
  });

  it('reports an unrecognised LOG_LEVEL rather than falling back to the default', () => {
    process.env.LOG_LEVEL = 'verbose';

    expect(env.tryLoad(load).error).toContain('LOG_LEVEL');
  });
});
