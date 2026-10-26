import { AuthMethod }                from '../core/auth/auth-method';
import type { IMailboxAuthProvider } from '../core/auth/auth-provider';
import { Permission }                from '../core/auth/jmap-scopes';

/** Artifact context that resolves every package a Mailbox synthesizes, so tests need no artifact store. */
export const TEST_ARTIFACT_CONTEXT = {
  bucketBase: 'test-artifacts',
  packages:   {
    'mailbox-go':         { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk':        { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
    'mailbox-cdk-edge':   { zone: 'edge', version: '1.0.0' },
    'mailbox-admin-ui':   { zone: 'regional', version: '1.0.0' },
    'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
  },
};

/** The values a test varies on the mock provider; every other field is the same for all tests. */
export interface MockAuthProviderOptions {
  readonly scopeMap?:     IMailboxAuthProvider['scopeMap'];
  readonly jmapClientId?: string;
}

/**
 * Minimal IMailboxAuthProvider for synthesizing a Mailbox. The defaults are the admin and JMAP clients
 * and the mail scopes; a test overrides only the value its assertions depend on.
 */
export function createMockAuthProvider(options: MockAuthProviderOptions = {}): IMailboxAuthProvider {
  return {
    issuer:                  'https://example.com/issuer',
    tokenEndpoint:           'https://example.com/token',
    authorizationEndpoint:   'https://example.com/authorize',
    authMethod:              AuthMethod.HEADER,
    usePkce:                 false,
    scopeMap:                options.scopeMap ?? {
      'mail.read':  [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies:                {
      adminApi: { audiences: ['admin-api'], requireAnyOfGroups: ['admins'] },
      jmapApi:  { audiences: ['jmap-api'] },
    },
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient:  () => ({ clientId: options.jmapClientId ?? 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons:    () => [],
  };
}
