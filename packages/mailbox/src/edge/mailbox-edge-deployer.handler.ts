import { wrapHandler } from 'aws-custom-resources';

// Use the AWS SDK v2 provided by the Lambda runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AWS = require('aws-sdk');

export interface MailboxEdgeDeployerProperties {
  stackName: string;
  templateUrl: string;
  /** CloudFormation stack parameters for the edge stack */
  parameters?: Record<string, string | undefined>;
  /** Whether to enable termination protection on the edge stack */
  terminationProtection?: boolean;
}

function toCfnParameters(parameters?: Record<string, string | undefined>): Array<{ ParameterKey: string; ParameterValue: string }> {
  if (!parameters) {
    return [];
  }

  const out: Array<{ ParameterKey: string; ParameterValue: string }> = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined) {
      continue;
    }
    out.push({ ParameterKey: key, ParameterValue: value });
  }
  return out;
}

async function describeStack(cf: any, stackName: string): Promise<any | undefined> {
  try {
    const resp = await cf.describeStacks({ StackName: stackName }).promise();
    return resp.Stacks?.[0];
  } catch (err: any) {
    if (err?.code === 'ValidationError' && String(err?.message ?? '').includes('does not exist')) {
      return undefined;
    }
    throw err;
  }
}

function outputsToObject(outputs?: Array<{ OutputKey?: string; OutputValue?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of outputs ?? []) {
    if (o.OutputKey && o.OutputValue !== undefined) {
      out[o.OutputKey] = o.OutputValue;
    }
  }
  return out;
}

export const handler = wrapHandler(async (event) => {
  const props = event.ResourceProperties as MailboxEdgeDeployerProperties;

  const cf = new AWS.CloudFormation({ region: 'us-east-1' });
  const stackName = props.stackName;

  if (event.RequestType === 'Delete') {
    const existing = await describeStack(cf, stackName);
    if (!existing) {
      return {};
    }

    await cf.deleteStack({ StackName: stackName }).promise();
    await cf.waitFor('stackDeleteComplete', { StackName: stackName }).promise();
    return {};
  }

  const parameters = toCfnParameters(props.parameters);

  const existing = await describeStack(cf, stackName);
  if (!existing) {
    await cf
      .createStack({
        StackName: stackName,
        TemplateURL: props.templateUrl,
        Parameters: parameters,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
        EnableTerminationProtection: props.terminationProtection ?? false,
      })
      .promise();

    await cf.waitFor('stackCreateComplete', { StackName: stackName }).promise();
  } else {
    try {
      await cf
        .updateStack({
          StackName: stackName,
          TemplateURL: props.templateUrl,
          Parameters: parameters,
          Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
        })
        .promise();

      await cf.waitFor('stackUpdateComplete', { StackName: stackName }).promise();
    } catch (err: any) {
      const message = String(err?.message ?? '');
      if (err?.code === 'ValidationError' && message.includes('No updates are to be performed')) {
        // No-op
      } else {
        throw err;
      }
    }
  }

  const updated = await describeStack(cf, stackName);
  const outputs = outputsToObject(updated?.Outputs);

  // Return all outputs so the CDK construct can expose specific ones.
  return outputs;
});
