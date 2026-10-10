/**
 * MailboxUserPool artifact resolution.
 *
 * With no injected resolver, MailboxUserPool builds its own from the versions shipped with the
 * package, overridden by CDK context; with an injected resolver, every package its sub-constructs
 * resolve must be pinned on it. The context here pins only the packages whose code the construct
 * actually creates: `mailbox-cognito` and `mailbox-cdk-shared` (home of the stack deployer and
 * stack helpers Lambdas).
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { MailboxUserPool } from '../mailbox-user-pool';

describe('MailboxUserPool without an injected artifactResolver', () => {
  function synthesizeWithPinnedContext(): Template {
    const app = new App();
    app.node.setContext('serverlessinbox:artifacts', {
      bucketBase: 'test-artifacts',
      packages: {
        'mailbox-cognito': { zone: 'regional', version: '0.0.1-test' },
        'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
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

describe('MailboxUserPool with an injected artifactResolver', () => {
  it('fails to synthesize naming the package the resolver holds no pin for', () => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const resolverWithoutSharedPackage = new PinnedArtifactResolver({
      packages: { 'mailbox-cognito': { zone: ArtifactZone.REGIONAL, version: '0.0.1-test' } },
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });

    expect(() => {
      new MailboxUserPool(stack, 'user-pool', {
        domain: { kind: 'cognito', cognitoDomainPrefix: 'test-prefix' },
        artifactResolver: resolverWithoutSharedPackage,
      });
    }).toThrow("No resolved data for package 'mailbox-cdk-shared'");
  });
});
