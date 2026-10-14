import {
  toDecodedBlobId,
  type DecodedBlobId,
  type EncodedBlobId,
  type ParsedBlobId,
} from './blob-id';

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

interface EntityAndPath {
  readonly entityId: string;
  readonly path: string;
}

/**
 * The wire format of a blob id: how the id in a download URL is decoded, split into its parts, and checked for
 * a path that cannot escape the S3 prefix the id is mapped to. It makes no authorization decision; whether the
 * parts may be served is the authorizer's.
 */
export class BlobIdFormat {
  /** Decodes the base64url form; an empty id or one outside the base64url alphabet has no decoded form. */
  public static decode(encoded: EncodedBlobId): DecodedBlobId | null {
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
  public static parse(decoded: DecodedBlobId): ParsedBlobId | null {
    if (decoded.startsWith('eml:')) {
      return BlobIdFormat.parseEmail(decoded.slice(4));
    }
    if (decoded.startsWith('cnt:')) {
      return BlobIdFormat.parseEntityBlob('contact', decoded.slice(4));
    }
    if (decoded.startsWith('prn:')) {
      return BlobIdFormat.parseEntityBlob('principal', decoded.slice(4));
    }
    return null;
  }

  /**
   * A path is safe to place in an S3 key only when it cannot leave its prefix: it is not empty or `..`, and it
   * holds no path separator or control character.
   */
  public static isSafePath(path: string): boolean {
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

  private static parseEmail(rest: string): ParsedBlobId | null {
    const split = BlobIdFormat.splitEntityAndPath(rest);
    if (split === null) {
      return null;
    }

    const lastColonIdx = split.path.lastIndexOf(':');
    if (lastColonIdx < 0) {
      return { type: 'email', entityId: split.entityId, path: split.path, mac: null };
    }

    return {
      type: 'email',
      entityId: split.entityId,
      path: split.path.slice(0, lastColonIdx),
      mac: split.path.slice(lastColonIdx + 1),
    };
  }

  private static parseEntityBlob(type: 'contact' | 'principal', rest: string): ParsedBlobId | null {
    const split = BlobIdFormat.splitEntityAndPath(rest);
    return split === null ? null : { type, entityId: split.entityId, path: split.path };
  }

  private static splitEntityAndPath(rest: string): EntityAndPath | null {
    const idx = rest.indexOf(':');
    if (idx < 0) {
      return null;
    }
    return { entityId: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
}
