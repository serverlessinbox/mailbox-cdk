/**
 * The fields of a CloudFormation custom-resource request that a Lambda reads. `wrapHandler`'s event type does
 * not declare `PhysicalResourceId`, which every Update and Delete carries, so a handler assigns its event to
 * this type to read it.
 */
export interface CustomResourceRequest {
  readonly RequestType: string;
  readonly StackId: string;
  readonly RequestId: string;
  readonly LogicalResourceId: string;
  readonly PhysicalResourceId?: string;
  readonly ResourceProperties?: unknown;
}

/** An answer to CloudFormation that carries only the physical id and no attributes. */
export interface CustomResourceAnswer {
  readonly PhysicalResourceId?: string;
}
