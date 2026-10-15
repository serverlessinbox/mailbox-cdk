/**
 * Supplies the two mandatory variables of the DCR Lambda for a test that imports `../handler`, which loads its
 * configuration when it is imported. Import this file first: the imports of a test file run in source order, and
 * a variable set in `beforeEach` is set after the handler has loaded.
 */
if (!process.env.IDENTITY_PROVISIONER_FUNCTION_NAME) {
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner-fn';
}
if (!process.env.USER_POOL_ID) {
  process.env.USER_POOL_ID = 'pool-1';
}

export {};
