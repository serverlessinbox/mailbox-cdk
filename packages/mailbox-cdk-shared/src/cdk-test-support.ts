// CDK test support: helpers for reading a synthesized template in tests.
// TEST-ONLY exports; only test files import this subpath, so it never reaches a package's runtime or bundle.

export { getAttLogicalId } from './cdk-test-support/get-att-logical-id';
export { renderLiteralText, renderWithTokens } from './cdk-test-support/render-with-tokens';
export {
  handlerSourceOf,
  managedLambdasOf,
  probeManagedLambda,
  type ManagedLambda,
  type ProbeOutcome,
} from './cdk-test-support/managed-lambdas';
export {
  actionsOf,
  allPolicyStatements,
  resourcesOf,
  statementsForAction,
  statementsForResource,
  statementsForRole,
  statementsOfDocument,
  statementsOfNamedPolicy,
  type PolicyStatementJson,
} from './cdk-test-support/policy-statements';
