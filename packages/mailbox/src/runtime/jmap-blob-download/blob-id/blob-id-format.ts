import {
  toDecodedBlobId,
  type ContactBlob,
  type DecodedBlobId,
  type EmailBlob,
  type EncodedBlobId,
  type ParsedBlobId,
  type PrincipalBlob,
} from './blob-id';

/** The two halves of a blob id after its prefix: the entity it names and the rest of the id. */
interface EntityAndPath {
  readonly entityId: string;
  readonly path:     string;
}

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

/** Decodes the base64url form; an empty id or one outside the base64url alphabet has no decoded form. */
export function decodeBlobId(encoded: EncodedBlobId): DecodedBlobId | null {
  if (!encoded || !BASE64URL_ALPHABET.test(encoded)) {
    return null;
  }

  return toDecodedBlobId(Buffer.from(encoded, 'base64url').toString('utf-8'));
}

/**
 * Splits a decoded blob id by its prefix: `eml:{emailId}:{path}:{mac}`, `cnt:{cardId}:{path}` or
 * `prn:{principalId}:{path}`. A path may contain colons, so the email MAC is the segment after the LAST colon.
 * An id with an unknown prefix or no path separator has no parsed form.
 */
export function parseBlobId(decoded: DecodedBlobId): ParsedBlobId | null {
  if (decoded.startsWith('eml:')) {
    return parseEmailBlob(decoded.slice(4));
  }
  if (decoded.startsWith('cnt:')) {
    return parseEntityBlob('contact', decoded.slice(4));
  }
  if (decoded.startsWith('prn:')) {
    return parseEntityBlob('principal', decoded.slice(4));
  }
  return null;
}

/**
 * A path is safe to place in an S3 key only when it cannot leave its prefix: it is not empty or `..`, and it
 * holds no path separator or control character.
 */
export function isSafeBlobPath(path: string): boolean {
  if (!path) {
    return false;
  }

  if (path.includes('/') || path.includes('\\')) {
    return false;
  }

  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) <= 0x1f) {
      return false;
    }
  }

  return path !== '..';
}

function parseEmailBlob(rest: string): EmailBlob | null {
  const split = splitEntityAndPath(rest);
  if (split === null) {
    return null;
  }

  const lastColonIdx = split.path.lastIndexOf(':');
  if (lastColonIdx < 0) {
    return { type: 'email', entityId: split.entityId, path: split.path, mac: null };
  }

  return {
    type:     'email',
    entityId: split.entityId,
    path:     split.path.slice(0, lastColonIdx),
    mac:      split.path.slice(lastColonIdx + 1),
  };
}

function parseEntityBlob(type: ContactBlob['type'] | PrincipalBlob['type'], rest: string): ContactBlob | PrincipalBlob | null {
  const split = splitEntityAndPath(rest);
  return split === null ? null : { type, entityId: split.entityId, path: split.path };
}

function splitEntityAndPath(rest: string): EntityAndPath | null {
  const idx = rest.indexOf(':');
  if (idx < 0) {
    return null;
  }
  return { entityId: rest.slice(0, idx), path: rest.slice(idx + 1) };
}
