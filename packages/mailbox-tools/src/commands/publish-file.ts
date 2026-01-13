import * as fs from 'fs';
import * as path from 'path';
import { Command, Option } from 'clipanion';
import { ensureAwsCliAvailable } from '../utils/common';
import { resolveRegions, resolveTarget, resolveFilePath, uploadFileToRegions, type PublishMode } from '../utils/publish';

export class PublishFileCommand extends Command {
  static override paths = [['publish', 'file']];

  static override usage = Command.Usage({
    description:
      'Upload a file as-is to the artifact bucket under packages/<package>/<version|channels/<channel>>/',
    examples: [
      [
        'Publish a CloudFormation template (immutable release)',
        '$0 publish file --mode release --package mailbox-cdk --version 1.2.3 --file dist/template.json --objectName template.json',
      ],
      [
        'Publish a template to a channel (overwrite-friendly)',
        '$0 publish file --mode channel --package mailbox-cdk --channel main --file dist/template.json --objectName template.json',
      ],
    ],
  });

  mode = Option.String('--mode', 'release', {
    description: 'Publishing mode: release (immutable) or channel (overwrite-friendly).',
  }) as PublishMode;

  packageName = Option.String('--package', {
    required: true,
    description: 'Package name used in S3 prefix, e.g. mailbox-cdk, mailbox-webmail-ui.',
  });

  version = Option.String('--version', {
    description: 'SemVer version (without leading v). Required when --mode release.',
  });

  channel = Option.String('--channel', {
    description: 'Channel name. Required when --mode channel.',
  });

  regions = Option.String('--regions', {
    description:
      'Comma-separated regions to publish into. Defaults to publish config regions for the mode.',
  });

  filePath = Option.String('--file', {
    required: true,
    description: 'File path to upload.',
  });
  
  objectName = Option.String('--objectName', {
    required: true,
    description: 'Object name inside the package prefix.',
  });

  awsProfile = Option.String('--awsProfile', {
    description: 'AWS profile to use for uploading.',
  });

  async execute(): Promise<number> {
    await ensureAwsCliAvailable();

    const regions = resolveRegions(this.mode, this.regions);
    const target = resolveTarget(this.mode, { version: this.version, channel: this.channel });

    const resolvedFilePath = resolveFilePath(this.filePath, 'file');
    const objectName = (this.objectName ?? path.basename(resolvedFilePath)).trim();
    if (!objectName) {
      throw new Error('--objectName resolved to empty');
    }

    uploadFileToRegions({
      packageName: this.packageName,
      target,
      objectName,
      filePath: resolvedFilePath,
      regions,
      awsProfile: this.awsProfile,
      log: (msg) => this.context.stdout.write(`${msg}\n`),
    });

    return 0;
  }
}
