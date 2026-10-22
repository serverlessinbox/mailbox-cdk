// CDK test support: helpers for reading a synthesized template in tests. Test-only exports.

export { sharedWorkerServiceName } from './cdk-test-support/deployer-service-names';
export { sharedSubStackTagKeys, tagKeysOf } from './cdk-test-support/deployer-tag-keys';
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
