/// <reference types="jest" />

/**
 * `config.ts` reads and validates every env var this Lambda needs exactly once, at module load.
 * These tests never statically import `../config` or `../handler` at the top of the file — a
 * static import here would evaluate before any test body runs (before we've set env), so every
 * case uses `jest.resetModules()` + a dynamic `import()` to control exactly what env is present
 * when the module is first evaluated.
 */
describe('config (cold-start env validation)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('exposes both env vars once both are set', () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-name';
    process.env.USER_POOL_ID = 'pool-id';

    let config: any;
    jest.isolateModules(() => {
      config = require('../config').config;
    });

    expect(config).toEqual({ identityProvisionerFunctionName: 'fn-name', userPoolId: 'pool-id' });
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('throws at module load when IDENTITY_PROVISIONER_FUNCTION_NAME is %s', (_label: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    } else {
      process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = value;
    }
    process.env.USER_POOL_ID = 'pool-id';

    expect(() => {
      jest.isolateModules(() => {
        require('../config');
      });
    }).toThrow(/IDENTITY_PROVISIONER_FUNCTION_NAME is not configured/);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('throws at module load when USER_POOL_ID is %s', (_label: string, value: string | undefined) => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-name';
    if (value === undefined) {
      delete process.env.USER_POOL_ID;
    } else {
      process.env.USER_POOL_ID = value;
    }

    expect(() => {
      jest.isolateModules(() => {
        require('../config');
      });
    }).toThrow(/USER_POOL_ID is not configured/);
  });
});
