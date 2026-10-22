/**
 * An ARN split into all of its parts. `resource` is the whole resource part;
 * `resourceType`, `resourceId` and `qualifier` are its breakdown by separator form:
 *
 * | resource part       | resourceType | resourceId   | qualifier |
 * |---------------------|--------------|--------------|-----------|
 * | `id`                | undefined    | `id`         | undefined |
 * | `type/id`           | `type`       | `id`         | undefined |
 * | `type:id`           | `type`       | `id`         | undefined |
 * | `type:id:qualifier` | `type`       | `id`         | `qualifier` |
 *
 * After the first `/` everything is the id, so `role/path/name` has the id `path/name`. After
 * `type:id:` everything is the qualifier. `resourceName` is the id without its path: the part after
 * the id's last `/`, so `role/path/name` has the name `name`; it equals the id when the id holds no
 * `/`. `region` and `account` are empty strings for services whose ARNs omit them (S3, IAM).
 */
export interface ParsedArn {
  readonly partition:    string;
  readonly service:      string;
  readonly region:       string;
  readonly account:      string;
  readonly resource:     string;
  readonly resourceType: string | undefined;
  readonly resourceId:   string;
  readonly resourceName: string;
  readonly qualifier:    string | undefined;
}

/** The parts an ARN is written from; `resource` is the whole resource part, such as `execution:name:id`. */
export interface ArnParts {
  readonly partition: string;
  readonly service:   string;
  readonly region:    string;
  readonly account:   string;
  readonly resource:  string;
}

/** The breakdown of an ARN's resource part: the fields of `ParsedArn` that depend on its separator form. */
type ResourceParts = Pick<ParsedArn, 'resourceType' | 'resourceId' | 'qualifier'>;

const ARN_LEADING_PARTS = 5;

/**
 * Parses `arn:partition:service:region:account:resource` into every part.
 * Throws an error naming the ARN and the problem when the ARN is malformed: a prefix other than
 * `arn`, fewer than six colon-separated parts, an empty partition, service or resource, or a
 * resource whose type, id or qualifier is empty where its separator promises one.
 */
export function parseArn(arn: string): ParsedArn {
  const segments = arn.split(':');
  // Fewer than six colon-separated parts leave no room for a resource.
  if (segments.length <= ARN_LEADING_PARTS) {
    throw invalidArn(arn, 'expected arn:partition:service:region:account:resource');
  }
  const [prefix, partition, service, region, account] = segments;
  // Only a string that starts with "arn" is an ARN.
  if (prefix !== 'arn') {
    throw invalidArn(arn, `expected the prefix "arn", got "${prefix}"`);
  }
  // Partition and service are required parts; region and account may legitimately be empty.
  if (!partition) {
    throw invalidArn(arn, 'the partition is empty');
  }
  if (!service) {
    throw invalidArn(arn, 'the service is empty');
  }
  const resource = segments.slice(ARN_LEADING_PARTS).join(':');
  // An ARN names a resource; an empty resource part names nothing.
  if (!resource) {
    throw invalidArn(arn, 'the resource is empty');
  }

  const { resourceType, resourceId, qualifier } = parseResource(arn, resource);
  const resourceName                            = resourceId.slice(resourceId.lastIndexOf('/') + 1);
  return { partition, service, region, account, resource, resourceType, resourceId, resourceName, qualifier };
}

/** Writes `arn:partition:service:region:account:resource`; the inverse of `parseArn` for the parts it returns. */
export function formatArn(parts: ArnParts): string {
  return ['arn', parts.partition, parts.service, parts.region, parts.account, parts.resource].join(':');
}

function parseResource(arn: string, resource: string): ResourceParts {
  const separatorIndex = resource.search(/[/:]/);
  // A resource part without a separator is a bare id.
  if (separatorIndex === -1) {
    return { resourceType: undefined, resourceId: resource, qualifier: undefined };
  }

  const resourceType = resource.slice(0, separatorIndex);
  // A separator promises a type in front of it.
  if (!resourceType) {
    throw invalidArn(arn, 'the resource type is empty');
  }
  const afterType = resource.slice(separatorIndex + 1);

  // After a slash everything is the id, so an id with a path keeps its slashes and has no qualifier.
  if (resource[separatorIndex] === '/') {
    if (!afterType) {
      throw invalidArn(arn, 'the resource id is empty');
    }
    return { resourceType, resourceId: afterType, qualifier: undefined };
  }

  const qualifierIndex = afterType.indexOf(':');
  const resourceId     = qualifierIndex === -1 ? afterType : afterType.slice(0, qualifierIndex);
  // A colon after the type promises an id in front of the next colon.
  if (!resourceId) {
    throw invalidArn(arn, 'the resource id is empty');
  }
  if (qualifierIndex === -1) {
    return { resourceType, resourceId, qualifier: undefined };
  }

  const qualifier = afterType.slice(qualifierIndex + 1);
  // A second colon promises a qualifier, and everything after it belongs to the qualifier.
  if (!qualifier) {
    throw invalidArn(arn, 'the qualifier is empty');
  }
  return { resourceType, resourceId, qualifier };
}

function invalidArn(arn: string, problem: string): Error {
  return new Error(`Invalid ARN "${arn}": ${problem}`);
}
