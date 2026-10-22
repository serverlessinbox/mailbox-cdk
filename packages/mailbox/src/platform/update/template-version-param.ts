import * as ssm                       from 'aws-cdk-lib/aws-ssm';
import { Construct }                  from 'constructs';

import type { ITemplateVersionParam } from '../../contracts/template-version-param';

/** Inputs of the template-version parameter. */
export interface TemplateVersionParamProps {
  /** Template version string (e.g., 'v0.0.53' or '0.0.0-dev') stored as the parameter's value. */
  readonly templateVersion: string;
}

/**
 * SSM StringParameter holding the deployed template version. Rendered into the CloudFormation
 * template so it survives quick-create deploys (customers never pass `--tags` or otherwise set
 * stack-level metadata).
 *
 * The parameter has no explicit name: CloudFormation derives its physical name from the parameter
 * resource's own logical ID. The value is fixed at synth time to the `templateVersion` the
 * composing stack was built with; it is not kept current after deploy.
 */
export class TemplateVersionParam extends ssm.StringParameter implements ITemplateVersionParam {
  constructor(scope: Construct, id: string, props: TemplateVersionParamProps) {
    super(scope, id, {
      stringValue: props.templateVersion,
      tier:        ssm.ParameterTier.STANDARD,
    });
  }
}
