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
 * Parsed representation of a blob ID.
 */
export type ParsedBlobId =
  | { type: 'email'; entityId: string; path: string }
  | { type: 'contact'; entityId: string; path: string }
  | { type: 'principal'; entityId: string; path: string };

/**
 * Parse a blob ID into its type, entity ID and path.
 *
 * Supported formats:
 *   eml:{emailID}:{path}        — email blob
 *   cnt:{contactCardID}:{path}  — contact media blob
 *   prn:{principalID}:{path}    — principal picture blob
 */
export function parseBlobId(blobId: string): ParsedBlobId | null {
  if (blobId.startsWith('eml:')) {
    const rest = blobId.slice(4);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    return { type: 'email', entityId: rest.slice(0, idx), path: rest.slice(idx + 1) };
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
 * JMAP download URL parameters (spec compliant)
 */
export interface DownloadParams {
  accountId: string;
  blobId: string;
  type?: string;  // Content-Type (MIME type)
  name?: string;  // Filename for download
}

/**
 * Extract JMAP download parameters from query string
 */
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
 * Construct S3 key from a parsed blob and its owning account.
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

/**
 * Add response headers for content type and filename
 */
export function addDownloadHeaders(
  request: any,
  type?: string,
  name?: string
): void {
  if (!request.headers) {
    request.headers = {};
  }

  // Set Content-Type header if provided
  if (type) {
    request.headers['x-content-type'] = [{
      key: 'X-Content-Type',
      value: type,
    }];
  }

  // Set Content-Disposition header if filename provided
  if (name) {
    // RFC 6266: Content-Disposition header for downloads
    const disposition = `attachment; filename="${name.replace(/"/g, '\\"')}"`;
    request.headers['x-content-disposition'] = [{
      key: 'X-Content-Disposition',
      value: disposition,
    }];
  }
}
