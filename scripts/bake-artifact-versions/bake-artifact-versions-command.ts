import { Command, Option }       from 'clipanion';
import * as path                 from 'node:path';

import { ArtifactVersionsBaker } from './artifact-versions-baker';
import { BakedPackages }         from './baked-packages';
import { BumpedVersionReader }   from './bumped-version-reader';
import { ExternalPinsReader }    from './external-pins-reader';

/**
 * CLI entry point of `bake-artifact-versions`: writes the `artifact-versions.json` of each
 * publishable package, after `gitversion bump` has set the versions of the packages this repo
 * releases itself. A failing read or an invalid result rejects `execute`.
 */
export class BakeArtifactVersionsCommand extends Command {
  static paths = [Command.Default];
  static usage = Command.Usage({
    description: 'Write the artifact-versions.json of the mailbox and mailbox-cognito packages: the externally released packages from a resolve-artifacts output, plus the packages this repo releases itself at the version the bump wrote into their package.json.',
    examples:    [
      [
        'Bake after resolving the external pins',
        'yarn resolve-artifacts --output /tmp/mailbox-external-pins.json && yarn bake-artifact-versions --mailbox-pins /tmp/mailbox-external-pins.json',
      ],
    ],
  });

  mailboxPins = Option.String('--mailbox-pins', {
    required:    true,
    description: 'Path to the artifact-registry resolve-artifacts output holding the externally released packages the mailbox package needs, relative to the current directory or absolute. Required; given once.',
  });
  root = Option.String('--root', {
    description: 'Repository root holding the packages folder. Defaults to the current directory; given once.',
  });

  async execute(): Promise<void> {
    const root            = path.resolve(this.root ?? process.cwd());
    const mailboxPinsFile = path.resolve(this.mailboxPins);

    const baker = new ArtifactVersionsBaker(new BumpedVersionReader(), new ExternalPinsReader());
    for (const bakedPackage of BakedPackages.forRepository(root, mailboxPinsFile)) {
      await baker.bake(bakedPackage);
      this.context.stdout.write(`Written: ${bakedPackage.outputFile}\n`);
    }
  }
}
