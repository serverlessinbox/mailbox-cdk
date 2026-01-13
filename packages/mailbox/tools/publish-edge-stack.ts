import { App } from 'aws-cdk-lib';
import { MailboxEdgeStack } from '../src/edge/mailbox-edge-stack';

/**
 * Synthesizes the edge stack CloudFormation template to dist/edge-stack-template.json
 * This is a wrapper around build-edge-stack.ts for convenience.
 */
function synthEdgeTemplate(): any {
  const app = new App();

  const stack = new MailboxEdgeStack(app, 'MailboxEdge', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
      region: 'us-east-1',
    },
  });

  const assembly = app.synth();
  const artifact = assembly.getStackArtifact(stack.artifactId);
  return artifact.template;
}

// Output the template to stdout for use with mailbox-tools publish-file
const template = synthEdgeTemplate();
console.log(JSON.stringify(template, null, 2));


