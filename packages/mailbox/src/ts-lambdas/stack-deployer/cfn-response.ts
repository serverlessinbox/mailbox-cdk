import { CfnEnvelope } from './types';

export async function putCfnResponse(args: {
  cfn: CfnEnvelope;
  status: 'SUCCESS' | 'FAILED';
  physicalResourceId: string;
  data?: Record<string, any>;
  reason?: string;
  logStreamName?: string;
}): Promise<void> {
  const { cfn, status, physicalResourceId, data, reason, logStreamName } = args;

  const body = {
    Status: status,
    Reason: reason ?? (logStreamName ? `See CloudWatch Log Stream: ${logStreamName}` : undefined),
    PhysicalResourceId: physicalResourceId,
    StackId: cfn.StackId,
    RequestId: cfn.RequestId,
    LogicalResourceId: cfn.LogicalResourceId,
    NoEcho: false,
    Data: data ?? {},
  };

  const resp = await fetch(cfn.ResponseURL, {
    method: 'PUT',
    body: JSON.stringify(body),
    // CloudFormation expects an empty content-type
    headers: {
      'content-type': '',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Failed to PUT CloudFormation response (HTTP ${resp.status}): ${text}`);
  }
}
