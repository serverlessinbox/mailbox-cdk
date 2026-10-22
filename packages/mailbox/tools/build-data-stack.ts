import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import * as fs                           from 'node:fs';
import * as path                         from 'node:path';

import { MailboxDataStack }              from '../src/core/data/mailbox-data-stack';

import { parseArgs, writeJson }          from './_common';

async function main() {
  const args   = parseArgs(process.argv.slice(2));
  const outDir = (typeof args.outDir === 'string' && args.outDir !== '') ? args.outDir : 'dist';

  const app   = new App();
  const stack = new MailboxDataStack(app, 'MailboxData', {
    env:         {
      account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
      region:  process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
    },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const assembly = app.synth();
  const artifact = assembly.getStackArtifact(stack.artifactId);
  const template = artifact.template;

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
