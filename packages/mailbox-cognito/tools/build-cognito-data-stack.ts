import { App, BootstraplessSynthesizer }      from 'aws-cdk-lib';
import * as fileSystem                        from 'node:fs/promises';
import * as path                              from 'node:path';

import { COGNITO_DATA_STACK_TEMPLATE_OBJECT } from '../src/data-stack/mailbox-cognito-data-stack-contract';
import { MailboxCognitoDataStack }            from '../src/data-stack/mailbox-cognito-data-stack';

import { parseArgs, writeJson }               from './_common';

async function main() {
  const args   = parseArgs(process.argv.slice(2));
  const outDir = (typeof args.outDir === 'string' && args.outDir !== '') ? args.outDir : 'dist';

  const app   = new App();
  const stack = new MailboxCognitoDataStack(app, 'MailboxCognitoData', {
    synthesizer: new BootstraplessSynthesizer(),
  });

  const assembly          = app.synth();
  const artifact          = assembly.getStackArtifact(stack.artifactId);
  const template: unknown = artifact.template;

  await fileSystem.mkdir(outDir, { recursive: true });

  const templatePath = path.join(outDir, COGNITO_DATA_STACK_TEMPLATE_OBJECT);
  await writeJson(templatePath, template);

  console.log(`✓ Built cognito data stack template: ${templatePath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
