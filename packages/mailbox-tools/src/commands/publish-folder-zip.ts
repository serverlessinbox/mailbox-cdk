import * as fs from 'fs';
import * as path from 'path';
import { Command, Option } from 'clipanion';
import { ensureAwsCliAvailable } from '../utils/common';
import { resolveRegions, resolveTarget, resolveDirPath, uploadFileToRegions, type PublishMode } from '../utils/publish';
import { stageZipDirectoryContents } from '../utils/zip';

export class PublishFolderZipCommand extends Command {
  static override paths = [['publish', 'folder']];

  static override usage = Command.Usage({
    description:
      'Zip a release directory and upload to the artifact bucket under packages/<package>/<version|channels/<channel>>/',
    examples: [
      [
        'Publish admin UI release (immutable)',
        '$0 publish folder --mode release --package mailbox-admin-ui --version 1.2.3 --releaseDir dist',
      ],
      [
        'Publish webmail UI release (channel, overwrite-friendly)',
        '$0 publish folder --mode channel --package mailbox-webmail-ui --channel main --releaseDir dist',
      ],
    ],
  });

  mode = Option.String('--mode', 'release', {
    description: 'Publishing mode: release (immutable) or channel (overwrite-friendly).',
  }) as PublishMode;

  packageName = Option.String('--package', {
    required: true,
    description: 'Package name used in S3 prefix, e.g. mailbox-admin-ui, mailbox-webmail-ui.',
  });

  version = Option.String('--version', {
    description: 'SemVer version (without leading v). Required when --mode release.',
  });

  channel = Option.String('--channel', {
    description: 'Channel name. Required when --mode channel.',
  });

  regions = Option.String('--regions', {
    description:
      'Comma-separated regions to publish into (release mode only). Defaults to publish config release regions.',
  });

  releaseDir = Option.String('--releaseDir', {
    required: true,
    description: 'Directory whose contents will be zipped and uploaded.',
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

    const resolvedDir = resolveDirPath(this.releaseDir, 'releaseDir');
    const staging = stageZipDirectoryContents(this.objectName, resolvedDir);
    try {
      const zipPath = path.join(staging.dir, this.objectName);

      uploadFileToRegions({
        packageName: this.packageName,
        target,
        objectName: this.objectName,
        filePath: zipPath,
        regions,
        awsProfile: this.awsProfile,
        log: (msg) => this.context.stdout.write(`${msg}\n`),
      });

      return 0;
    } finally {
      staging.cleanup();
    }
  }
}
