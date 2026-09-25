/**
 * CloudFront error response
 */
export function createErrorResponse(status: number, message: string) {
  return {
    status: status.toString(),
    statusDescription: message,
    headers: {
      'content-type': [{
        key: 'Content-Type',
        value: 'application/json',
      }],
    },
    body: JSON.stringify({ error: message }),
  };
}

/**
 * Decode a base64url-encoded blobId. Base64url uses the alphabet A-Za-z0-9-_ with no padding.
 */
export function decodeBase64UrlBlobId(blobId: string): string | null {
  if (!blobId || !/^[A-Za-z0-9_-]*$/.test(blobId)) {
    return null;
  }

  try {
    return Buffer.from(blobId, 'base64url').toString('utf-8');
  } catch (error) {
    return null;
  }
}

export type ParsedBlobId =
  | { type: 'email'; entityId: string; path: string; mac: string | null }
  | { type: 'contact'; entityId: string; path: string }
  | { type: 'principal'; entityId: string; path: string };

/**
 * Parse a blob ID into its type, entity ID, path, and MAC (for email blobs).
 *
 * Supported formats:
 *   eml:{emailID}:{path}:{mac}  — email blob with MAC (required)
 *   cnt:{contactCardID}:{path}  — contact media blob
 *   prn:{principalID}:{path}    — principal picture blob
 *
 * Filenames may contain colons; the MAC split uses the LAST colon, not the first.
 */
export function parseBlobId(blobId: string): ParsedBlobId | null {
  if (blobId.startsWith('eml:')) {
    const rest = blobId.slice(4);
    const firstColonIdx = rest.indexOf(':');
    if (firstColonIdx < 0) return null;

    const entityId = rest.slice(0, firstColonIdx);
    const remainder = rest.slice(firstColonIdx + 1);

    const lastColonIdx = remainder.lastIndexOf(':');
    if (lastColonIdx < 0) {
      return { type: 'email', entityId, path: remainder, mac: null };
    }

    const path = remainder.slice(0, lastColonIdx);
    const mac = remainder.slice(lastColonIdx + 1);

    return { type: 'email', entityId, path, mac };
  }
  if (blobId.startsWith('cnt:')) {
    const rest = blobId.slice(4);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    return { type: 'contact', entityId: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  if (blobId.startsWith('prn:')) {
    const rest = blobId.slice(4);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    return { type: 'principal', entityId: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  return null;
}

/**
 * Check if a blob path is safe to interpolate into an S3 key. The path is rejected if it
 * could escape the intended S3 prefix: empty, contains path separators or control chars, or
 * is equal to "..".
 */
export function isSafeBlobPath(path: string): boolean {
  if (!path) {
    return false;
  }

  if (path.includes('/') || path.includes('\\')) {
    return false;
  }

  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code >= 0x00 && code <= 0x1F) {
      return false;
    }
  }

  if (path === '..') {
    return false;
  }

  return true;
}

/**
 * JMAP download URL parameters
 */
export interface DownloadParams {
  accountId: string;
  blobId: string;
  type?: string;  // Content-Type (MIME type)
  name?: string;  // Filename for download
}

export function extractDownloadParams(queryString: string): DownloadParams | null {
  const params = new URLSearchParams(queryString);

  const accountId = params.get('accountId');
  const blobId = params.get('blobId');

  if (!accountId || !blobId) {
    return null;
  }

  return {
    accountId,
    blobId,
    type: params.get('type') || undefined,
    name: params.get('name') || undefined,
  };
}

/**
 * Construct S3 key: principal blobs are keyed under the tenant only, not an account.
 */
export function constructS3Key(
  tenantId: string,
  accountId: string,
  parsed: ParsedBlobId
): string {
  switch (parsed.type) {
    case 'email':
      return `tenants/${tenantId}/accounts/${accountId}/emails/${parsed.entityId}/${parsed.path}`;
    case 'contact':
      return `tenants/${tenantId}/accounts/${accountId}/contacts/${parsed.entityId}/${parsed.path}`;
    case 'principal':
      return `tenants/${tenantId}/principals/${parsed.entityId}/${parsed.path}`;
  }
}

export function addDownloadHeaders(
  request: any,
  type?: string,
  name?: string
): void {
  if (!request.headers) {
    request.headers = {};
  }

  if (type) {
    request.headers['x-content-type'] = [{
      key: 'X-Content-Type',
      value: type,
    }];
  }

  if (name) {
    // RFC 6266: Content-Disposition header for downloads
    const disposition = `attachment; filename="${name.replace(/"/g, '\\"')}"`;
    request.headers['x-content-disposition'] = [{
      key: 'X-Content-Disposition',
      value: disposition,
    }];
  }
}
