export interface UiDeployerResourceProperties {
  deploymentNonce?: string;

  targetBucket: string;

  /** When true, delete ALL objects in the target bucket on stack Delete. */
  clearAllOnDelete?: boolean;

  // Optional UI bundle deployment
  sourceBucket?: string;
  sourceKey?: string;
  sourceVersionId?: string;
  contentPrefix?: string;

  // Optional config
  configPrefix?: string;
  configJson?: string;

  // Optional CDN invalidation
  distributionId?: string;
  invalidationPaths?: string[];
}
