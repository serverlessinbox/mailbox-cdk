import { SsmActions, grantParameterActions } from '@serverlessinbox/mailbox-cdk-shared';
import { IGrantable }                        from 'aws-cdk-lib/aws-iam';
import * as ssm                              from 'aws-cdk-lib/aws-ssm';
import { Construct }                         from 'constructs';

export interface TemplateVersionParamProps {
  /** Template version string (e.g., 'v0.0.53' or '0.0.0-dev') stored as the parameter's value. */
  readonly templateVersion: string;
}

/**
 * Read access to the template-version SSM parameter without exposing the underlying parameter
 * construct. A holder can look up the parameter name (for a Lambda's env var) and request
 * `grantRead`; it cannot reach the raw CDK parameter construct through this interface.
 */
export interface ITemplateVersionParam {
  readonly parameterName: string;

  grantRead(grantee: IGrantable): void;
}

/**
 * SSM StringParameter holding the deployed template version. Rendered into the CloudFormation
 * template so it survives quick-create deploys (customers never pass `--tags` or otherwise set
 * stack-level metadata); `stack-update-api` reads it to detect drift against the latest release.
 *
 * `grantRead` exposes only `ssm:GetParameter`, the single API the reader calls.
 *
 * A plain TypeScript wrapper, not itself a CDK construct: it creates the `ssm.StringParameter` at
 * exactly the `(scope, id)` given to it, adding no extra node to the construct tree. This parameter
 * has no explicit name — CloudFormation derives its physical name from the parameter resource's own
 * logical ID — so an intervening construct would move that logical ID (and the deployed parameter's
 * identity) the moment this wrapper was introduced.
 *
 * Not responsible for keeping the value current after deploy — the value is fixed at synth time to
 * whatever `templateVersion` the composing stack was built with.
 */
export class TemplateVersionParam implements ITemplateVersionParam {
  public readonly parameter: ssm.StringParameter;
  public readonly parameterName: string;

  constructor(scope: Construct, id: string, props: TemplateVersionParamProps) {
    this.parameter     = new ssm.StringParameter(scope, id, {
      stringValue: props.templateVersion,
      tier: ssm.ParameterTier.STANDARD,
    });
    this.parameterName = this.parameter.parameterName;
  }

  public grantRead(grantee: IGrantable): void {
    grantParameterActions(grantee, this.parameter, SsmActions.read);
  }
}
