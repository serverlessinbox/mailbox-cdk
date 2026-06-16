/** @type {import('@serverlessinbox/artifact-tools').S3WorkspaceConfig} */
module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  region: 'eu-west-1',
  type: 'template',
  name: 'mailbox-standard',
  artifacts: [
    {
      objectName: 'template.json',
      sourcePath: 'cdk.out/MailboxStandard.template.json',
    },
    {
      objectName: 'config.json',
      sourcePath: 'config.json',
    },
  ],
};
