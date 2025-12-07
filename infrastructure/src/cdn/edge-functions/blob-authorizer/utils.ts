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
 * Parse blob ID into emailID and path
 */
export function parseBlobId(blobId: string): { emailID: string; path: string } | null {
  const parts = blobId.split(':');
  if (parts.length !== 2) {
    return null;
  }
  
  const [emailID, path] = parts;
  if (!emailID || !path) {
    return null;
  }
  
  return { emailID, path };
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
 * Construct S3 key from email entity and path
 */
export function constructS3Key(
  accountId: string,
  emailID: string,
  path: string
): string {
  return `accounts/${accountId}/emails/${emailID}/${path}`;
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
