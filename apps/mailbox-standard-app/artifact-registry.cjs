module.exports = {
  bucketName: 'mailbox-artifacts-eu-west-1',
  type: 'template',
  name: 'mailbox-standard',
  artifacts: [
    {
      source: 'cdk.out/MailboxStandard.template.json',
      objectName: 'MailboxStandard.template.json',
      region: 'eu-west-1',
    }
  ]
};
