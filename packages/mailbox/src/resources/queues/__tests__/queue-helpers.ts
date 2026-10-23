import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

/** A stack in a fixed account and region, so the queue tests do not depend on the caller's environment. */
export function createStack(): Stack {
  return new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}
