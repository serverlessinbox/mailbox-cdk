/// <reference types="jest" />

/**
 * Mailbox `extraAllowedOrigins` validation tests.
 *
 * The entries become CORS allowed origins on the APIs and the CDN. An entry that is not a bare
 * https origin never matches a browser's Origin header, so it fails the synthesis instead of
 * producing a CORS configuration that silently allows nothing.
 */

import * as cdk                                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                 from 'aws-cdk-lib';

import { Mailbox }                                       from '../mailbox';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT } from './mailbox-helpers';

describe('Mailbox extraAllowedOrigins', () => {
  function createMailbox(extraAllowedOrigins: string[]): Mailbox {
    const stack = new cdk.Stack(new App({ context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT } }), 'TestMailboxOrigins', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    return new Mailbox(stack, 'mailbox', { authProvider: createMockAuthProvider(), extraAllowedOrigins });
  }

  it.each([
    'http://app.example.com',
    'http://localhost.example.com',
    'http://localhost:5173/',
    'https://app.example.com/',
    'https://app.example.com/path',
    'https://app.example.com?x=1',
    'app.example.com',
  ])('throws for the entry %s, naming it', (origin) => {
    expect(() => createMailbox([origin])).toThrow(`extraAllowedOrigins entry '${origin}' is not valid`);
  });

  it('accepts an https origin with and without a port, and a token', () => {
    expect(() => createMailbox(['https://app.example.com', 'https://app.example.com:8443', cdk.Fn.ref('SomeParameter')])).not.toThrow();
  });

  it.each([
    'http://localhost',
    'http://localhost:5173',
    'http://127.0.0.1:9100',
  ])('accepts the local development origin %s', (origin) => {
    expect(() => createMailbox([origin])).not.toThrow();
  });
});
