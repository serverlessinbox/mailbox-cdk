import { App } from 'aws-cdk-lib';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { parseArgs, writeJson } from './_common';
import { MailboxDataStack } from '../src/data/mailbox-data-stack';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = (typeof args.outDir === 'string' && args.outDir !== '') ? args.outDir : 'dist';

  const app = new App();
  const stack = new MailboxDataStack(app, 'MailboxData', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
      region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
    },
  });

  const assembly = app.synth();
  const artifact = assembly.getStackArtifact(stack.artifactId);
  const template = artifact.template;

  // Remove CDK bootstrap version parameter and rules
  delete template.Parameters?.BootstrapVersion;
  delete template.Rules?.CheckBootstrapVersion;

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const templatePath = path.join(outDir, 'data-stack-template.json');
  writeJson(templatePath, template);

  // eslint-disable-next-line no-console
  console.log(`✓ Built data stack template: ${templatePath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
