/** A source that writes one object, with the given body, at an exact key. */
export type DataSourceSpec = {
  readonly kind:          'data';
  readonly key:           string;
  readonly body:          string;
  readonly contentType?:  string | undefined;
  readonly cacheControl?: string | undefined;
};

/** A source that unpacks a zip archive under a key prefix of the target bucket. */
export type ZipSourceSpec = {
  readonly kind:             'zip';
  readonly sourceBucket:     string;
  readonly sourceKey:        string;
  readonly targetPrefix:     string;
  readonly sourceVersionId?: string | undefined;
};

/** One source of a `Custom::ContentDeployment` resource, tagged by `kind`. */
export type StaticContentSourceSpec = DataSourceSpec | ZipSourceSpec;

/**
 * The properties of a `Custom::ContentDeployment` or `Custom::ContentInvalidation` resource: the sources to
 * deploy into `targetBucket`, then the CloudFront paths to invalidate. `ServiceToken`, which
 * CloudFormation adds to every request, is deliberately not listed. A type alias rather than an interface,
 * because the schema's inferred type accepts extra keys and only an alias is assignable to it.
 */
export type ContentDeployerResourceProperties = {
  readonly targetBucket?:      string | undefined;
  readonly deploymentNonce?:   string | undefined;
  readonly sources?:           StaticContentSourceSpec[] | undefined;
  readonly distributionId?:    string | undefined;
  readonly invalidationPaths?: string[] | undefined;
};
