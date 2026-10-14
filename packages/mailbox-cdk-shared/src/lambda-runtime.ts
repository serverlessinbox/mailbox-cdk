// Lambda runtime utilities: content operations and CloudFront management
// These are RUNTIME-ONLY exports; do not import from the main barrel in CDK synth-time code
// Depends on AWS SDK + npm packages that are not needed at synth time

export { deployZipToPrefix } from './ts-lambdas/shared/content-ops';
export { invalidateCloudFront } from './ts-lambdas/shared/cloudfront-invalidation';
export * as env from './ts-lambdas/shared/env';
export { withSmokeTest, SmokeTestProbe, SmokeTestResponse } from './ts-lambdas/shared/with-smoke-test';
export { emitManualFinalize, type EmitManualFinalizeOptions } from './ts-lambdas/shared/manual-finalize';
export { LoggerBuffer, parseLogLevelStrict, type LogLevel, type LogEntry } from './ts-lambdas/shared/logger-buffer';
export { loadBaseConfig, loadLogLevel, type BaseConfig } from './ts-lambdas/shared/base-config';
export { ExpectedFailure } from './ts-lambdas/shared/expected-failure';
export { answerRequestWithBadConfig } from './ts-lambdas/shared/bad-config-answer';
export type { CustomResourceAnswer, CustomResourceRequest } from './ts-lambdas/shared/custom-resource-request';
export { CaughtError } from './ts-lambdas/shared/caught-error';
export { parseArn, type ParsedArn } from './ts-lambdas/shared/arn';
export type { Branded } from './ts-lambdas/shared/branded';
export { isParentStackRollingBack, isParentStackBeingDeleted } from './ts-lambdas/shared/stack-rollback-detector';
