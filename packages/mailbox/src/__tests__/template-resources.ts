import type { Template }        from 'aws-cdk-lib/assertions';
import * as t                   from 'typanion';
import type { StrictValidator } from 'typanion';

/** A value of a synthesized template: a literal string or number, or an intrinsic function CloudFormation resolves at deploy time. */
export const isTemplateValue = t.isOneOf([t.isString(), t.isNumber(), t.isPartial({})]);

/** A value of a synthesized template: a literal string or number, or an intrinsic function CloudFormation resolves at deploy time. */
export type TemplateValue = t.InferType<typeof isTemplateValue>;

/** One synthesized resource of a template: its logical id, its policies and dependencies, and its properties as the caller's schema describes them. */
export interface TemplateResource<TProperties> {
  readonly logicalId:            string;
  readonly properties:           TProperties;
  readonly deletionPolicy?:      string;
  readonly updateReplacePolicy?: string;
  readonly dependsOn:            string[];
}

const isResourceEnvelope = t.isPartial({
  DeletionPolicy:      t.isOptional(t.isString()),
  UpdateReplacePolicy: t.isOptional(t.isString()),
  DependsOn:           t.isOptional(t.isOneOf([t.isString(), t.isArray(t.isString())])),
});

/**
 * Every resource of `resourceType` in the template, with its properties validated against
 * `isProperties`. A resource that does not fit throws, naming the resource and what is wrong, so a
 * test never reads a property the template does not carry.
 */
export function resourcesOfType<TProperties>(
  template: Template,
  resourceType: string,
  isProperties: StrictValidator<unknown, TProperties>,
): TemplateResource<TProperties>[] {
  return Object.entries(template.findResources(resourceType)).map(([logicalId, synthesized]) => {
    const resource: unknown = synthesized;
    const errors: string[]  = [];

    if (!isResourceEnvelope(resource, { errors })) {
      throw new Error(`${resourceType} ${logicalId} is not a resource: ${errors.join('; ')}`);
    }
    const properties: unknown = 'Properties' in resource ? resource.Properties : undefined;
    if (!isProperties(properties, { errors })) {
      throw new Error(`${resourceType} ${logicalId} has unexpected properties: ${errors.join('; ')}`);
    }

    return {
      logicalId,
      properties,
      deletionPolicy:      resource.DeletionPolicy,
      updateReplacePolicy: resource.UpdateReplacePolicy,
      dependsOn:           [resource.DependsOn ?? []].flat(),
    };
  });
}
