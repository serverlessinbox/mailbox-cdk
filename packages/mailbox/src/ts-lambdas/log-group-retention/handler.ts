import { wrapHandler } from 'aws-custom-resources';
import { CloudWatchLogsClient, PutRetentionPolicyCommand } from '@aws-sdk/client-cloudwatch-logs';

export interface LogGroupRetentionResourceProperties {
  LogGroupName: string;
  RetentionInDays: number | string;
}

const logsClient = new CloudWatchLogsClient({});

export const handler = wrapHandler(async (event) => {
  const props = (event.ResourceProperties ?? {}) as Partial<LogGroupRetentionResourceProperties>;

  const logGroupName = String(props.LogGroupName ?? '').trim();
  if (!logGroupName) throw new Error('Missing required property: LogGroupName');

  const retentionInDaysRaw = props.RetentionInDays;
  const retentionInDays = Number(retentionInDaysRaw);
  if (!Number.isFinite(retentionInDays) || retentionInDays <= 0) {
    throw new Error(`Invalid RetentionInDays: ${String(retentionInDaysRaw)}`);
  }

  const physicalResourceId = event.PhysicalResourceId ?? `log-retention:${logGroupName}`;

  if (event.RequestType === 'Delete') {
    // Never delete or reset retention on delete; leave log group as-is.
    return {
      PhysicalResourceId: physicalResourceId,
      Data: {
        Message: 'Log group retained on delete',
      },
    };
  }

  await logsClient.send(
    new PutRetentionPolicyCommand({
      logGroupName,
      retentionInDays,
    }),
  );

  return {
    PhysicalResourceId: physicalResourceId,
    Data: {
      Message: `Set retention to ${retentionInDays} days`,
    },
  };
});
