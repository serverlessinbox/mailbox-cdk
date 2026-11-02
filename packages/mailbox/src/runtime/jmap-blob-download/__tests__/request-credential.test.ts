/**
 * Pins which credential a download request presents. A personal access token secret goes to the token path, a Bearer
 * JWT to the JWT path, and anything else is refused. A Basic credential that is not a token must not fall through to
 * the JWT path, and a secret of the wrong length must not reach the table.
 */

import { CredentialReader, PAT_SECRET_LENGTH, PAT_SECRET_PREFIX } from '../request-credential';

import { originRequestOf }                                        from './jmap-blob-download-helpers';

const SECRET = `${PAT_SECRET_PREFIX}${'a'.repeat(PAT_SECRET_LENGTH - PAT_SECRET_PREFIX.length)}`;

function basic(password: string, username = 'token-user'): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

describe('CredentialReader', () => {
  const credentials = new CredentialReader();

  function readAuthorization(authorization: string | null) {
    return credentials.read(originRequestOf({ authorization }));
  }

  it('reads a Bearer token that is not a personal access token as a JWT', () => {
    expect(readAuthorization('Bearer eyJhbGciOi.payload.signature')).toEqual({ kind: 'jwt', token: 'eyJhbGciOi.payload.signature' });
  });

  it('reads a Bearer token that starts with the prefix and has the secret length as a personal access token', () => {
    expect(readAuthorization(`Bearer ${SECRET}`)).toEqual({ kind: 'pat', secret: SECRET });
  });

  it('reads the password of a Basic credential as a personal access token, ignoring the username', () => {
    expect(readAuthorization(basic(SECRET, 'anyone'))).toEqual({ kind: 'pat', secret: SECRET });
  });

  it('refuses a Basic credential whose password is not a personal access token, rather than reading it as a JWT', () => {
    expect(readAuthorization(basic('eyJhbGciOi.payload.signature'))).toEqual({
      kind:   'refused',
      reason: 'Basic credential is not a personal access token',
    });
  });

  it.each([
    { presented: 'a Bearer secret', authorization: `Bearer ${SECRET}extra` },
    { presented: 'a Bearer secret one character short', authorization: `Bearer ${SECRET.slice(0, -1)}` },
    { presented: 'a Basic secret one character short', authorization: basic(SECRET.slice(0, -1)) },
  ])('refuses $presented before any read, naming its length', ({ authorization }) => {
    expect(readAuthorization(authorization)).toEqual({
      kind:   'refused',
      reason: 'personal access token secret has the wrong length',
    });
  });

  it.each([
    { scheme: 'no header', authorization: null },
    { scheme: 'an unknown scheme', authorization: 'Token abc' },
    { scheme: 'a Bearer header with no token', authorization: 'Bearer ' },
  ])('refuses a request with $scheme', ({ authorization }) => {
    expect(readAuthorization(authorization)).toEqual({ kind: 'refused', reason: 'no Bearer token or Basic credential' });
  });
});
