import type { TSESTree }        from '@typescript-eslint/utils';

import { ImportTargetResolver } from '../zones/import-target-resolver';
import { ZoneClassifier }       from '../zones/zone-classifier';

import { createRule }           from './create-rule';

// Only resources/lambdas and resources/events may import an event value. A type-only import of
// an event's interface is allowed everywhere.

export const eventsImport = createRule({
  name:           'events-import',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'only resources/lambdas and resources/events import resources/events',
    },
    schema:   [],
    messages: {
      eventImport: 'Only resources/lambdas and resources/events import an event. Import its type with import type.',
    },
  },
  defaultOptions: [],
  create(context) {
    const classifier = new ZoneClassifier();
    const resolver   = new ImportTargetResolver(classifier);
    const importer   = classifier.locate(context.filename);
    if (!classifier.eventsRestricted(importer)) {
      return {};
    }

    const checkSource = (source: TSESTree.StringLiteral, isTypeOnly: boolean): void => {
      const target = resolver.resolve(source.value, context.filename);
      if (isTypeOnly || !classifier.isEvent(target.location)) {
        return;
      }
      context.report({ node: source, messageId: 'eventImport' });
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
