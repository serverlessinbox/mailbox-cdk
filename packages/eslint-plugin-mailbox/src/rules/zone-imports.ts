import type { TSESTree }        from '@typescript-eslint/utils';

import { ImportTargetResolver } from '../zones/import-target-resolver';
import { mailboxPackage }       from '../zones/package-roots';
import { ZoneClassifier }       from '../zones/zone-classifier';

import { createRule }           from './create-rule';

// Checks an import inside packages/mailbox/src against the zone matrix. A named import of a
// platform-list file is not checked: the platform-list rule covers relative imports only.

export const zoneImports = createRule({
  name:           'zone-imports',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'enforce the zone matrix between core, platform, platform-list, resources and contracts',
    },
    schema:   [],
    messages: {
      forbidden: 'The {{importer}} zone never imports the {{target}} zone.',
      typeOnly:  'The {{importer}} zone imports the {{target}} zone only with import type.',
    },
  },
  defaultOptions: [],
  create(context) {
    const classifier = new ZoneClassifier();
    const resolver   = new ImportTargetResolver(classifier);
    const importer   = classifier.locate(context.filename);
    if (importer.packageRoot !== mailboxPackage || classifier.isExempt(importer)) {
      return {};
    }
    const importerZone = classifier.importerZone(importer);

    const checkSource = (source: TSESTree.StringLiteral, isTypeOnly: boolean): void => {
      const target = resolver.resolve(source.value, context.filename);
      if (importerZone === 'platform-list' && !target.relative) {
        return;
      }
      const targetZone = classifier.targetZone(target.location);
      const verdict    = classifier.verdict(importerZone, targetZone);
      const data       = { importer: importerZone, target: targetZone };
      if (verdict === 'forbid') {
        context.report({ node: source, messageId: 'forbidden', data });
      } else if (verdict === 'typeOnly' && !isTypeOnly) {
        context.report({ node: source, messageId: 'typeOnly', data });
      }
    };

    return {
      ImportDeclaration:      (node) => checkSource(node.source, node.importKind === 'type'),
      ExportAllDeclaration:   (node) => checkSource(node.source, node.exportKind === 'type'),
      ExportNamedDeclaration: (node) => {
        if (node.source) {
          checkSource(node.source, node.exportKind === 'type');
        }
      },
    };
  },
});
