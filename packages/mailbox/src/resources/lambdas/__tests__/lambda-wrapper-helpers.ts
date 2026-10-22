import type { PolicyStatementJson } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { statementsForRole }        from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { Template }            from 'aws-cdk-lib/assertions';

/** The parts of a synthesized `AWS::Lambda::Function` that the wrapper tests read. */
interface SynthesizedFunctionResource {
  readonly Properties: {
    readonly Role:        { readonly 'Fn::GetAtt': [string, string] };
    readonly Environment: { readonly Variables: Record<string, unknown> };
  };
}

/** The only Lambda function of a synthesized stack: its logical ID, its environment and the statements of its role. */
export interface SynthesizedLambda {
  readonly logicalId:   string;
  readonly environment: Record<string, unknown>;
  readonly statements:  PolicyStatementJson[];
}

/** Reads the one Lambda function a wrapper test builds; a stack with any other number throws. */
export function onlyLambdaOf(template: Template): SynthesizedLambda {
  // cast: CDK's findResources returns untyped template JSON; this is the one framework boundary.
  const functions = Object.entries(template.findResources('AWS::Lambda::Function')) as Array<[string, SynthesizedFunctionResource]>;
  if (functions.length !== 1) {
    throw new Error(`expected one Lambda function, found ${functions.length}`);
  }
  const [[logicalId, resource]] = functions;
  return {
    logicalId,
    environment: resource.Properties.Environment.Variables,
    statements:  statementsForRole(template, resource.Properties.Role['Fn::GetAtt'][0]),
  };
}
