export const publishConfig = {
  // Artifact bucket base name; final bucket is `${bucketBase}-${region}`.
  bucketBase: 'mailbox-artifacts',

  // Channel publishing: intentionally overwrite-friendly; defaults to a single region.
  channel: {
    regions: ['eu-west-1'],
  },

  // Release publishing: publish to all deploy regions.
  release: {
    regions: ['eu-west-1'],
  },
} as const;

export type PublishTarget =
  | {
    kind: 'release';
    version: string; // e.g. 1.4.0 (no leading v)
  }
  | {
    kind: 'channel';
    channel: string; // e.g. main, staging, dev
  };

export function artifactBucketName(bucketBase: string, region: string): string {
  return `${bucketBase}-${region}`;
}

export function packagePrefix(packageName: string, target: PublishTarget): string {
  if (!packageName || packageName.trim() === '') {
    throw new Error('packageName is required');
  }

  if (target.kind === 'release') {
    if (!target.version || target.version.trim() === '') {
      throw new Error('version is required when kind=release');
    }
    return `packages/${packageName}/v${target.version}`;
  }

  const channel = target.channel.trim();
  if (!channel) {
    throw new Error('channel is required when kind=channel');
  }
  return `packages/${packageName}/channels/${channel}`;
}
