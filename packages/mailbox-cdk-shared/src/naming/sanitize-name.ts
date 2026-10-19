/**
 * Reduces a stack name to `a-z0-9-`: lowercases it, turns every other character into a hyphen,
 * collapses hyphen runs and drops leading and trailing hyphens, which is what S3 bucket names
 * (lowercase letters, digits, hyphens, starting and ending with a letter or digit) require.
 * The 3-63 character length limit is not enforced here.
 */
export function sanitizeStackName(stackName: string): string {
  return stackName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
