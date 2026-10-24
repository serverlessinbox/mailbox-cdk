import { posix }                 from 'node:path';

import { packageRoots }          from './package-roots';
import type { SourceLocation }   from './zone-classifier';
import type { ZoneClassifier }   from './zone-classifier';

export interface ImportTarget {
  readonly relative: boolean;
  readonly location: SourceLocation | null;
}

// Turns an import specifier into the location it names. A relative specifier resolves against
// the importing file; a package-name specifier maps onto that package's src/ folder.
export class ImportTargetResolver {
  private readonly classifier: ZoneClassifier;

  public constructor(classifier: ZoneClassifier) {
    this.classifier = classifier;
  }

  public resolve(specifier: string, importingFile: string): ImportTarget {
    if (specifier.startsWith('.')) {
      const repoPath = posix.normalize(posix.join(posix.dirname(importingFile), specifier));

      return { relative: true, location: this.classifier.locate(repoPath) };
    }
    const root = packageRoots.find((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
    if (!root) {
      return { relative: false, location: null };
    }
    const sub = specifier.slice(root.name.length + 1);

    return { relative: false, location: this.classifier.locate(`packages/${root.dir}/src/${sub === '' ? 'index' : sub}`) };
  }
}
