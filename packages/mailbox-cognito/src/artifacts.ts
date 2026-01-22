/**
 * Default artifact package name for runtime lambdas owned by @sipkg/mailbox-cognito.
 *
 * Published to S3 as: packages/<packageName>/(channels/<channel>|v<version>)/lambdas/*.zip
 */
export const COGNITO_LAMBDAS_ARTIFACT_PACKAGE = 'mailbox-cognito-lambdas' as const;
