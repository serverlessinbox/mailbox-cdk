import { App } from 'aws-cdk-lib';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  parseArgs,
  writeJson,
} from './_common';
import { MailboxEdgeStack } from '../src/edge/mailbox-edge-stack';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const outDir = (typeof args.outDir === 'string' && args.outDir !== '') ? args.outDir : 'dist';

  const app = new App();

  const stack = new MailboxEdgeStack(app, 'MailboxEdge', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
      region: 'us-east-1',
    },
  });

  const assembly = app.synth();
  const artifact = assembly.getStackArtifact(stack.artifactId);
  const template = artifact.template;

  // Remove CDK bootstrap version parameter and rules - customers shouldn't need CDK bootstrap
  delete template.Parameters?.BootstrapVersion;
  delete template.Rules?.CheckBootstrapVersion;

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const templatePath = path.join(outDir, 'edge-stack-template.json');
  writeJson(templatePath, template);

  // eslint-disable-next-line no-console
  console.log(`✓ Built edge stack template: ${templatePath}`);
  // eslint-disable-next-line no-console
  console.log(`  Parameters:`);
  // eslint-disable-next-line no-console
  console.log(`    - domainName (required)`);
  // eslint-disable-next-line no-console
  console.log(`    - prefix (optional)`);
  // eslint-disable-next-line no-console
  console.log(`    - hostedZoneId (optional)`);
  // eslint-disable-next-line no-console
  console.log(`    - hostedZoneName (optional, required if hostedZoneId is set)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
