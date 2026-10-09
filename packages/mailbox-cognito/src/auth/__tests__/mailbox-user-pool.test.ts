/**
 * MailboxUserPool artifact-package registration.
 *
 * With no injected resolver, MailboxUserPool loads its own pinned resolver from CDK context and
 * must register every artifact package its sub-constructs resolve. A package that is resolved but
 * never registered fails synth with `Artifact package "<name>" was not registered`. The context
 * here pins only the packages whose code the construct actually creates: `mailbox-cognito` and
 * `mailbox-cdk-shared` (home of the stack deployer and stack helpers Lambdas).
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MailboxUserPool } from '../mailbox-user-pool';

describe('MailboxUserPool without an injected artifactResolver', () => {
  function synthesizeWithPinnedContext(): Template {
    const app = new App();
    app.node.setContext('serverlessinbox:artifacts', {
      bucketBase: 'test-artifacts',
      packages: {
        'mailbox-cognito': { kind: 'release', version: '0.0.1-test' },
        'mailbox-cdk-shared': { kind: 'release', version: '0.0.1-test' },
      },
    });
    app.node.setContext('serverlessinbox:artifact_versions', {});
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    new MailboxUserPool(stack, 'user-pool', {
      domain: { kind: 'cognito', cognitoDomainPrefix: 'test-prefix' },
    });

    return Template.fromStack(stack);
  }

  it('synthesizes the stack deployer Lambdas from the mailbox-cdk-shared package', () => {
    const template = synthesizeWithPinnedContext();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: Match.stringLikeRegexp('mailbox-cdk-shared/.*/lambdas/stack-deployer\\.zip') },
    });
  });
});
