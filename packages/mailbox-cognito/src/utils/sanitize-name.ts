/**
 * Sanitize stack name for valid AWS resource naming.
 *
 * S3 bucket names must:
 * - Be 3-63 characters long
 * - Contain only lowercase letters, numbers, hyphens
 * - Start and end with letter or number
 */
export function sanitizeStackName(stackName: string): string {
  return stackName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
