import type { TSESTree }              from '@typescript-eslint/utils';

import { ImportTargetResolver }       from '../zones/import-target-resolver';
import { mailboxPackage, kitPackage } from '../zones/package-roots';
import { ZoneClassifier }             from '../zones/zone-classifier';

import { createRule }                 from './create-rule';

// The kit package (mailbox-cdk-shared) never imports the mailbox package, by name or by path.

export const kitIsolation = createRule({
  name:           'kit-isolation',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'the kit never imports the mailbox package',
    },
    schema:   [],
    messages: {
      mailboxImport: 'The kit never imports the mailbox package.',
    },
  },
  defaultOptions: [],
  create(context) {
    const classifier = new ZoneClassifier();
    const resolver   = new ImportTargetResolver(classifier);
    const importer   = classifier.locate(context.filename);
    if (importer.packageRoot !== kitPackage || classifier.isExempt(importer)) {
      return {};
    }

    const checkSource = (source: TSESTree.StringLiteral): void => {
      const target = resolver.resolve(source.value, context.filename);
      if (target.location?.packageRoot === mailboxPackage) {
        context.report({ node: source, messageId: 'mailboxImport' });
      }
    };

    return {
      ImportDeclaration:      (node) => checkSource(node.source),
      ExportAllDeclaration:   (node) => checkSource(node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) {
          checkSource(node.source);
        }
      },
    };
  },
});
