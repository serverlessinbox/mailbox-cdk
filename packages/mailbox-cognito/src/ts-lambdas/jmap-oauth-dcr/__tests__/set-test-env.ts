/**
 * `config.ts` validates its env vars once at module load (cold start), so any test file that
 * statically imports `../handler` or `../pool-resolver` needs those vars present *before* that
 * import executes — a `beforeEach` mutation runs too late; the module has already loaded by
 * then.
 *
 * Import this module FIRST, ahead of any of this Lambda's own modules, in a test file that
 * needs the happy-path (already-valid) config. Import order — not the position of a
 * `process.env` assignment — is what makes this reliable: sibling `import` statements execute
 * in source order, so a leading side-effect import always runs before the ones after it.
 *
 * Cold-start *failure* behaviour (missing/empty env) is exercised separately, in
 * `config.test.ts`, via `jest.resetModules()` + dynamic `import()` — this file only supplies
 * valid defaults for tests that don't care about config failure.
 */
if (!process.env.IDENTITY_PROVISIONER_FUNCTION_NAME) {
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner-fn';
}
if (!process.env.USER_POOL_ID) {
  process.env.USER_POOL_ID = 'pool-1';
}

export {};
