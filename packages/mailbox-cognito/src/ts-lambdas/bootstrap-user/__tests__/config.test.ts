/// <reference types="jest" />

/**
 * Pins the one place this configuration departs from the shared base configuration: SERVICE_NAME is optional.
 * Making it mandatory would reject any template that does not set it and fail the resource.
 */

import { env }  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { load } from '../config';

describe('bootstrap-user config', () => {
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnvironment = { ...process.env };
    delete process.env.SERVICE_NAME;
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('loads an empty service name when SERVICE_NAME is absent', () => {
    expect(env.tryLoad(load)).toEqual({
      config: { logLevel: 'error', serviceName: '' },
      error: undefined,
    });
  });

  it('loads SERVICE_NAME when it is set', () => {
    process.env.SERVICE_NAME = 'test-service';

    expect(env.tryLoad(load).config?.serviceName).toBe('test-service');
  });
});
