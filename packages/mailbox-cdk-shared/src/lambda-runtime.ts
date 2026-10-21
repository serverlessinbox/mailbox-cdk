// Lambda runtime utilities: content operations and CloudFront management
// These are RUNTIME-ONLY exports; do not import from the main barrel in CDK synth-time code
// Depends on AWS SDK + npm packages that are not needed at synth time

export { deployZipToPrefix } from './ts-lambdas/shared/content-ops';
export { invalidateCloudFront } from './ts-lambdas/shared/cloudfront-invalidation';
export * as env from './runtime/handler-kit/config/config-env';
export { withSmokeTest, SmokeTestProbe, SmokeTestResponse } from './ts-lambdas/shared/with-smoke-test';
export { emitManualFinalize, type EmitManualFinalizeOptions } from './runtime/handler-kit/custom-resource/custom-resource-manual-finalize';
export { LoggerBuffer, parseLogLevelStrict, type LogLevel, type LogEntry } from './ts-lambdas/shared/logger-buffer';
export { loadBaseConfig, loadLogLevel, type BaseConfig } from './runtime/handler-kit/config/config-base';
export { ExpectedFailure } from './runtime/handler-kit/errors/expected-failure';
export { answerRequestWithBadConfig } from './runtime/handler-kit/custom-resource/custom-resource-bad-config-answer';
export type { CustomResourceAnswer, CustomResourceRequest } from './runtime/handler-kit/custom-resource/custom-resource-request';
export { CaughtError } from './runtime/handler-kit/errors/caught-error';
export { parseArn, type ParsedArn } from './ts-lambdas/shared/arn';
export { isBrandedString, type Branded, type Unbranded } from './ts-lambdas/shared/branded';
export {
  toStackName,
  toStackId,
  toLogicalResourceId,
  toRequestId,
  toPhysicalResourceId,
  toResponseUrl,
  isStackName,
  isStackId,
  isLogicalResourceId,
  isRequestId,
  isResponseUrl,
  type StackName,
  type StackId,
  type LogicalResourceId,
  type RequestId,
  type PhysicalResourceId,
  type ResponseUrl,
} from './runtime/handler-kit/custom-resource/custom-resource-identifiers';
export {
  toRegion,
  toTableName,
  toFunctionName,
  toQueueUrl,
  isRegion,
  type Region,
  type TableName,
  type FunctionName,
  type QueueUrl,
} from './ts-lambdas/shared/aws-identifiers';
export {
  toTenantId,
  toAccountId,
  toIssuer,
  isTenantId,
  isAccountId,
  type TenantId,
  type AccountId,
  type Issuer,
} from './ts-lambdas/shared/auth-identifiers';
export { ServerlessInboxTagKeys } from './ts-lambdas/shared/tag-keys';
export { createCloudFormationClient, type CloudFormationClient } from './ts-lambdas/shared/cloudformation-client';
export { isParentStackRollingBack, isParentStackBeingDeleted } from './runtime/handler-kit/custom-resource/custom-resource-rollback-detector';
