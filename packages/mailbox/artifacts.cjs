/** @type {import('@serverlessinbox/artifact-tools').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  basePath: 'packages/mailbox-cdk',
  artifacts: [
    {
      source: 'src/ts-lambdas/edge-deployer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/edge-deployer.zip',
    },
    {
      source: 'src/ts-lambdas/ui-deployer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/ui-deployer.zip',
    },
    {
      source: 'src/ts-lambdas/blob-authorizer/index.ts',
      bundleType: 'js-zip',
      objectName: 'lambdas/blob-authorizer.zip',
      bucketName: 'mailbox-artifacts-us-east-1',
      basePath: 'packages/mailbox-cdk-edge',
      region: 'us-east-1',
    },
    {
      source: 'dist/edge-stack-template.json',
      objectName: 'template.json',
      bucketName: 'mailbox-artifacts-us-east-1',
      basePath: 'packages/mailbox-cdk-edge',
      region: 'us-east-1',
    },
  ],
};
