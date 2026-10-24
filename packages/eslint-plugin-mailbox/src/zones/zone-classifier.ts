import { contractResourcePaths, platformOnlyEventPaths, platformOnlyPaths, zoneMatrix } from './mailbox-zones';
import type { ImporterZone, TargetZone, Verdict }                                       from './mailbox-zones';
import { mailboxPackage, packageRoots }                                                 from './package-roots';
import type { PackageRoot }                                                             from './package-roots';

export interface SourceLocation {
  readonly packageRoot: PackageRoot | null;
  readonly rest:        string;
}

const sourcePattern = /(?:^|\/)packages\/([^/]+)\/src\/(.+)$/;

const exemptPattern = /(^|\/)(__tests__|runtime)\//;

// Classifies a file or an import target by its path below a package's src/ folder.
export class ZoneClassifier {
  public locate(repoPath: string): SourceLocation {
    const match = sourcePattern.exec(repoPath);
    if (!match) {
      return { packageRoot: null, rest: repoPath };
    }
    const [, dir, rest] = match;

    return { packageRoot: packageRoots.find((root) => root.dir === dir) ?? null, rest: rest.replace(/\.ts$/, '') };
  }

  public isExempt(location: SourceLocation): boolean {
    return exemptPattern.test(location.rest);
  }

  public importerZone(location: SourceLocation): ImporterZone {
    const { rest } = location;
    if (rest.startsWith('core/')) {
      return 'core';
    }
    if (rest.startsWith('platform/')) {
      return 'platform';
    }
    if (platformOnlyPaths.includes(rest) || platformOnlyEventPaths.includes(rest)) {
      return 'platform-list';
    }
    if (rest.startsWith('resources/')) {
      return 'resources';
    }
    if (rest.startsWith('contracts/')) {
      return 'contracts';
    }

    return 'other';
  }

  public targetZone(location: SourceLocation | null): TargetZone {
    if (location === null || location.packageRoot !== mailboxPackage) {
      return 'foreign';
    }
    const { rest } = location;
    if (rest === 'core/apis/addons') {
      return 'core-addons';
    }
    if (rest === 'core/auth/types') {
      return 'core-auth-types';
    }
    if (rest.startsWith('core/')) {
      return 'core';
    }
    if (rest.startsWith('platform/')) {
      return 'platform';
    }
    if (platformOnlyEventPaths.includes(rest)) {
      return 'platform-list-event';
    }
    if (platformOnlyPaths.includes(rest)) {
      return 'platform-list';
    }
    if (contractResourcePaths.includes(rest)) {
      return 'contract-resource';
    }
    if (rest.startsWith('resources/')) {
      return 'resources';
    }
    if (rest.startsWith('contracts/')) {
      return 'contracts';
    }
    if (rest.startsWith('utils/') || rest.startsWith('runtime/')) {
      return 'utils-runtime';
    }

    return 'other';
  }

  // A file in resources/lambdas or resources/events wires events and is never restricted by them.
  public isWiring(location: SourceLocation): boolean {
    return location.rest.startsWith('resources/lambdas/') || location.rest.startsWith('resources/events/');
  }

  public isEvent(location: SourceLocation | null): boolean {
    return location !== null && location.rest.startsWith('resources/events/');
  }

  // Mailbox core, platform and resources never import an event; kit and cognito index files may.
  public eventsRestricted(location: SourceLocation): boolean {
    if (location.packageRoot === null || this.isExempt(location) || this.isWiring(location)) {
      return false;
    }
    if (location.packageRoot === mailboxPackage) {
      const zone = this.importerZone(location);

      return zone === 'core' || zone === 'platform' || zone === 'resources';
    }

    return location.rest !== 'index';
  }

  public verdict(importer: ImporterZone, target: TargetZone): Verdict {
    const cell = zoneMatrix.find(([cellImporter, cellTarget]) => cellImporter === importer && cellTarget === target);
    if (!cell) {
      throw new Error(`no zone-matrix cell for ${importer} -> ${target}`);
    }

    return cell[2];
  }
}
