/// <reference types="jest" />

/**
 * Mailbox: deterministic synthesis.
 *
 * Synthesizing the same Mailbox app twice must produce the same template. A value that differs between
 * runs (a clock reading, a random suffix) changes a resource property on every synth, so every deploy
 * of an unchanged app reports changes and may replace resources.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';

const ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages: {
    'mailbox-go': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    },
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function synthesizeMailboxTemplate(): string {
  const app = new App({ context: { 'serverlessinbox:artifacts': ARTIFACT_CONTEXT } });
  const stack = new cdk.Stack(app, 'TestDeterminism', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  new Mailbox(stack, 'mailbox', { authProvider: createMockAuthProvider() });
  return JSON.stringify(Template.fromStack(stack).toJSON());
}

describe('Mailbox synthesized twice', () => {
  it('produces byte-identical templates', () => {
    expect(synthesizeMailboxTemplate()).toBe(synthesizeMailboxTemplate());
  });
});
