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

  it('exposes both env vars once both are set', async () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-name';
    process.env.USER_POOL_ID = 'pool-id';

    const { config } = await import('../config');

    expect(config).toEqual({ identityProvisionerFunctionName: 'fn-name', userPoolId: 'pool-id' });
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('throws at module load when IDENTITY_PROVISIONER_FUNCTION_NAME is %s', async (_label, value) => {
    if (value === undefined) {
      delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    } else {
      process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = value;
    }
    process.env.USER_POOL_ID = 'pool-id';

    await expect(import('../config')).rejects.toThrow(/IDENTITY_PROVISIONER_FUNCTION_NAME is not configured/);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('throws at module load when USER_POOL_ID is %s', async (_label, value) => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-name';
    if (value === undefined) {
      delete process.env.USER_POOL_ID;
    } else {
      process.env.USER_POOL_ID = value;
    }

    await expect(import('../config')).rejects.toThrow(/USER_POOL_ID is not configured/);
  });
});
