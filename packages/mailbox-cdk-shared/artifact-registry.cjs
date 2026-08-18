/** @type {import('@serverlessinbox/artifact-registry').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'package',
  name: 'mailbox-cdk-shared',
  artifacts: [
    {
      source: '/tmp/content-deployer.zip',
      objectName: 'lambdas/content-deployer.zip',
    },
  ],
};
