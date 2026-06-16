/** @type {import('@serverlessinbox/artifact-tools').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'package',
  name: 'mailbox-cognito-lambdas',
  artifacts: [
    {
      source: '/tmp/cognito-idp-users-api.zip',
      objectName: 'lambdas/cognito-idp-users-api.zip',
    },
    {
      source: '/tmp/cognito-custom-message.zip',
      objectName: 'lambdas/cognito-custom-message.zip',
    },
    {
      source: '/tmp/cognito-bootstrap-user.zip',
      objectName: 'lambdas/cognito-bootstrap-user.zip',
    },
  ],
};
