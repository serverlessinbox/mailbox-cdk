import { firstHeaderValue, type CloudFrontRequest } from './cloudfront/cloudfront-event';

/** The prefix every personal access token secret carries. */
export const PAT_SECRET_PREFIX = 'sipat_';

/** The length of a personal access token secret: the prefix, the body and the checksum. */
export const PAT_SECRET_LENGTH = 55;

const BASIC_PREFIX = 'basic ';

/** A Bearer-shaped `Authorization` header: its scheme as sent, and the one token after it. */
interface BearerCredential {
  readonly scheme: string;
  readonly token:  string;
}

/**
 * The credential a request presents: a personal access token secret, a JWT, or nothing the authorizer accepts.
 * A refused credential carries the reason for the log, never the credential itself.
 */
export type RequestCredential =
  | { readonly kind: 'pat'; readonly secret: string }
  | { readonly kind: 'jwt'; readonly token: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** A credential the authorizer accepts for a further check: a personal access token secret or a JWT. */
export type AcceptedCredential = Exclude<RequestCredential, { readonly kind: 'refused' }>;

/**
 * Reads the credential from the `Authorization` header. A Bearer token that starts with the personal access token
 * prefix, or a Basic credential whose password does, is a personal access token secret; any other Bearer token is a
 * JWT; any other Basic credential is refused, and so is a secret of the wrong length. A personal access token secret
 * is checked here, before any read, so that junk never reaches the table. The Bearer scheme matches case-insensitively for a personal access token; a JWT needs the exact `Bearer` scheme.
 */
export class CredentialReader {
  public read(request: CloudFrontRequest): RequestCredential {
    const header = firstHeaderValue(request.headers, 'authorization') ?? '';

    const bearer = this.bearerToken(header);
    if (bearer !== undefined && bearer.scheme.toLowerCase() === 'bearer') {
      if (bearer.token.startsWith(PAT_SECRET_PREFIX)) {
        return this.patCredential(bearer.token);
      }
      if (bearer.scheme === 'Bearer') {
        return { kind: 'jwt', token: bearer.token };
      }
    }

    const basicPassword = this.basicPassword(header);
    if (basicPassword === undefined) {
      return { kind: 'refused', reason: 'no Bearer token or Basic credential' };
    }
    if (!basicPassword.startsWith(PAT_SECRET_PREFIX)) {
      return { kind: 'refused', reason: 'Basic credential is not a personal access token' };
    }
    return this.patCredential(basicPassword);
  }

  private bearerToken(header: string): BearerCredential | undefined {
    const parts = header.split(' ');
    if (parts.length !== 2 || !parts[1]) {
      return undefined;
    }
    return { scheme: parts[0], token: parts[1] };
  }

  private basicPassword(header: string): string | undefined {
    const trimmed = header.trim();
    if (!trimmed.toLowerCase().startsWith(BASIC_PREFIX)) {
      return undefined;
    }

    const decoded   = Buffer.from(trimmed.slice(BASIC_PREFIX.length).trim(), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator === -1 ? undefined : decoded.slice(separator + 1);
  }

  private patCredential(secret: string): RequestCredential {
    if (secret.length !== PAT_SECRET_LENGTH) {
      return { kind: 'refused', reason: 'personal access token secret has the wrong length' };
    }
    return { kind: 'pat', secret };
  }
}
