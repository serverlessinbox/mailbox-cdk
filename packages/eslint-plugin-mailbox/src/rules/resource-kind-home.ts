import { AST_NODE_TYPES, type TSESLint, type TSESTree }    from '@typescript-eslint/utils';

import { type CoveredKind, coveredKinds }                  from '../model/covered-kinds';

import { createRule }                                      from './create-rule';

// A covered class is created only in resources/<kind>/ of its own kind, under a source root (`/src/`).
// Classes are matched by name, bare or as a member, not by the module they come from.

type ResourceKindMessageId = 'wrongFolder';

type ResourceKindContext = Readonly<TSESLint.RuleContext<ResourceKindMessageId, []>>;

interface CoveredClass {
  readonly kind:      CoveredKind;
  readonly className: string;
}

export const resourceKindHome = createRule({
  name:           'resource-kind-home',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'a covered resource class is created only in the resources folder of its own kind',
    },
    schema:   [],
    messages: {
      wrongFolder: 'G-model R1: new {{className}} belongs in resources/{{folder}}/ as a defined resource, not here.',
    },
  },
  defaultOptions: [],
  create(context) {
    const checker = new ResourceKindChecker(context);

    return {
      NewExpression: (node) => checker.checkNewExpression(node),
    };
  },
});

class ResourceKindChecker {
  private readonly context: ResourceKindContext;

  constructor(context: ResourceKindContext) {
    this.context = context;
  }

  public checkNewExpression(node: TSESTree.NewExpression): void {
    const covered = this.coveredClassOf(node.callee);

    if (covered === undefined) {
      return;
    }
    if (this.isInOwnFolder(covered.kind)) {
      return;
    }

    this.context.report({
      node,
      messageId: 'wrongFolder',
      data:      { className: covered.className, folder: covered.kind.folder },
    });
  }

  private coveredClassOf(callee: TSESTree.NewExpression['callee']): CoveredClass | undefined {
    if (callee.type === AST_NODE_TYPES.Identifier) {
      return this.bareCoveredClass(callee.name);
    }
    if (callee.type === AST_NODE_TYPES.MemberExpression && callee.property.type === AST_NODE_TYPES.Identifier) {
      const namespace = callee.object.type === AST_NODE_TYPES.Identifier ? callee.object.name : undefined;

      return this.memberCoveredClass(callee.property.name, namespace);
    }

    return undefined;
  }

  private bareCoveredClass(className: string): CoveredClass | undefined {
    const kind = coveredKinds.find((candidate) => candidate.classNames.includes(className));

    return kind === undefined ? undefined : { kind, className };
  }

  private memberCoveredClass(className: string, namespace: string | undefined): CoveredClass | undefined {
    const kind = coveredKinds.find((candidate) => {
      if (!candidate.classNames.includes(className)) {
        return false;
      }
      if (candidate.namespaces === undefined) {
        return true;
      }

      return namespace !== undefined && candidate.namespaces.includes(namespace);
    });

    return kind === undefined ? undefined : { kind, className };
  }

  private isInOwnFolder(kind: CoveredKind): boolean {
    return this.context.filename.includes(`/src/resources/${kind.folder}/`);
  }
}
