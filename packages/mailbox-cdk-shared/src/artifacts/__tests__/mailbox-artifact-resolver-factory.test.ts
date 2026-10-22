/// <reference types="jest" />

/**
 * Pins what the factory contributes to `PinnedArtifactResolver.fromContext`: the product's two
 * context keys, the registry record as the default location, and the stack's region. If the keys
 * or the region are wired wrong, a deployment silently reads the baked pins instead of the
 * developer's override, or reads the wrong regional bucket.
 */

import { ArtifactZone }                         from '@serverlessinbox/artifact-registry-cdk';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { MailboxArtifactResolverFactory }       from '../mailbox-artifact-resolver-factory';

import { TEST_REGISTRY_RECORD }                 from './test-registry-record';

const DEFAULT_PINS = {
  'mailbox-go':       { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  'mailbox-cdk-edge': { version: '1.0.0', zone: ArtifactZone.EDGE },
};

function stackWithContext(context: Record<string, unknown>): Stack {
  return new Stack(new App({ context }), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('MailboxArtifactResolverFactory.fromContext', () => {
  it('resolves the baked pins from the record location in the stack region when no context is set', () => {
    const resolver = MailboxArtifactResolverFactory.fromContext(stackWithContext({}), TEST_REGISTRY_RECORD, DEFAULT_PINS);

    expect(resolver.resolve('mailbox-go', 'lambdas/api.zip').bucket).toBe('mailbox-artifacts-us-west-2');
    expect(resolver.resolve('mailbox-cdk-edge', 'edge-stack-template.json').bucket).toBe('mailbox-artifacts-us-east-1');
    expect(resolver.getVersion('mailbox-go')).toBe('1.0.0');
  });

  it('applies the serverlessinbox:artifacts context over the baked pins and location', () => {
    const stack = stackWithContext({
      'serverlessinbox:artifacts': {
        bucketBase: 'dev-artifacts',
        packages:   { 'mailbox-go': { zone: 'regional', channel: 'dev' } },
      },
    });

    const resolver = MailboxArtifactResolverFactory.fromContext(stack, TEST_REGISTRY_RECORD, DEFAULT_PINS);

    expect(resolver.getVersion('mailbox-go')).toBe('dev');
    expect(resolver.getVersion('mailbox-cdk-edge')).toBe('1.0.0');
    expect(resolver.resolve('mailbox-go', 'lambdas/api.zip').bucket).toBe('dev-artifacts-us-west-2');
  });

  it('pins objects to the S3 versions in the serverlessinbox:artifact_versions context', () => {
    const baseline = MailboxArtifactResolverFactory.fromContext(stackWithContext({}), TEST_REGISTRY_RECORD, DEFAULT_PINS);
    const key      = baseline.resolve('mailbox-go', 'lambdas/api.zip').key;
    const stack    = stackWithContext({ 'serverlessinbox:artifact_versions': { [key]: 'version-id-1' } });

    const resolver = MailboxArtifactResolverFactory.fromContext(stack, TEST_REGISTRY_RECORD, DEFAULT_PINS);

    expect(resolver.resolve('mailbox-go', 'lambdas/api.zip').versionId).toBe('version-id-1');
  });

  it('takes the bucket overrides of the registry record', () => {
    const record = { ...TEST_REGISTRY_RECORD, bucketOverrides: { 'us-west-2': 'custom-bucket-west' } };

    const resolver = MailboxArtifactResolverFactory.fromContext(stackWithContext({}), record, DEFAULT_PINS);

    expect(resolver.resolve('mailbox-go', 'lambdas/api.zip').bucket).toBe('custom-bucket-west');
  });
});
