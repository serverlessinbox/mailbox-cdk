/** @type {import('@serverlessinbox/artifact-registry').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'package',
  name: 'mailbox-cdk',
  artifacts: [
    {
      source: '/tmp/stack-deployer.zip',
      objectName: 'lambdas/stack-deployer.zip',
    },
    {
      source: '/tmp/ui-deployer.zip',
      objectName: 'lambdas/ui-deployer.zip',
    },
    {
      source: '/tmp/stack-helpers.zip',
      objectName: 'lambdas/stack-helpers.zip',
    },
    {
      source: '/tmp/resource-sweeper.zip',
      objectName: 'lambdas/resource-sweeper.zip',
    },
    {
      source: '/tmp/scheduled-updater.zip',
      objectName: 'lambdas/scheduled-updater.zip',
    },
    {
      source: 'dist/data-stack-template.json',
      objectName: 'data-stack-template.json',
    },
    {
      source: '/tmp/blob-authorizer.zip',
      objectName: 'lambdas/blob-authorizer.zip',
      bucketName: 'mailbox-artifacts-us-east-1',
      name: 'mailbox-cdk-edge',
      region: 'us-east-1',
    },
    {
      source: 'dist/edge-stack-template.json',
      objectName: 'edge-stack-template.json',
      bucketName: 'mailbox-artifacts-us-east-1',
      name: 'mailbox-cdk-edge',
      region: 'us-east-1',
    },
  ],
};
