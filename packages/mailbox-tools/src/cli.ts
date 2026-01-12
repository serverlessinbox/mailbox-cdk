import { Builtins, Cli } from 'clipanion';
import { BundleJsZipCommand } from './commands/bundle-js-zip';
import { PublishFileCommand } from './commands/publish-file';
import { PublishFolderZipCommand } from './commands/publish-folder-zip';

export async function runCli(argv: string[]) {
  const cli = new Cli({
    binaryLabel: 'mailbox-tools',
    binaryName: 'mailbox-tools',
    binaryVersion: '1.0.0',
  });

  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);

  cli.register(BundleJsZipCommand);
  cli.register(PublishFileCommand);
  cli.register(PublishFolderZipCommand);

  // Yarn scripts may inject a standalone `--` when forwarding args.
  const normalizedArgv = argv.filter((a) => a !== '--');
  await cli.runExit(normalizedArgv, Cli.defaultContext);
}
