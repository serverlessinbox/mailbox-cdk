/** @type {import('@serverlessinbox/artifact-tools').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'package',
  name: 'mailbox-cognito-lambdas',
  artifacts: [
    {
      source: 'src/ts-lambdas/cognito-idp-users-api/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/cognito-idp-users-api.zip',
    },
    {
      source: 'src/ts-lambdas/custom-message/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/cognito-custom-message.zip',
    },
    {
      source: 'src/ts-lambdas/bootstrap-user/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/cognito-bootstrap-user.zip',
    },
  ],
};
