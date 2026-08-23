/** @type {import('@serverlessinbox/artifact-registry').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'package',
  name: 'mailbox-cognito',
  artifacts: [
    {
      source: '/tmp/cognito-idp-users-api.zip',
      objectName: 'lambdas/cognito-idp-users-api.zip',
    },
    {
      source: '/tmp/cognito-bootstrap-user.zip',
      objectName: 'lambdas/cognito-bootstrap-user.zip',
    },
    {
      // objectName MUST stay `lambdas/jmap-oauth-dcr.zip` — JmapOAuthDcrLambda passes
      // `lambdaId: 'jmap-oauth-dcr'` and TypeScriptLambda resolves `lambdas/${lambdaId}.zip`.
      source: '/tmp/jmap-oauth-dcr.zip',
      objectName: 'lambdas/jmap-oauth-dcr.zip',
    },
    {
      source: 'dist/cognito-data-stack-template.json',
      objectName: 'cognito-data-stack-template.json',
    },
  ],
};
