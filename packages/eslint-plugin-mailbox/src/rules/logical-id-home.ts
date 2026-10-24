import { AST_NODE_TYPES, type TSESLint, type TSESTree }    from '@typescript-eslint/utils';

import { AllowListMatcher }                                from '../model/allow-list-matcher';
import { logicalIdAllowList }                              from '../model/logical-id-allow-list';

import { createRule }                                      from './create-rule';

// R4: overrideLogicalId is written by a Stack or NestedStack class, or by an allow-listed file.

type LogicalIdMessageId = 'logicalId';

type LogicalIdContext = Readonly<TSESLint.RuleContext<LogicalIdMessageId, []>>;

const logicalIdMessage = 'G-model R4: overrideLogicalId is written by a Stack class, or by a file on the R4 allow-list in packages/eslint-plugin-mailbox/src/model/logical-id-allow-list.ts that pins an externally unique resource.';

const stackClassNames = /^(Stack|NestedStack)$/;

export const logicalIdHome = createRule({
  name:           'logical-id-home',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'allow overrideLogicalId only in a Stack class or on the R4 allow-list',
    },
    schema:   [],
    messages: {
      logicalId: logicalIdMessage,
    },
  },
  defaultOptions: [],
  create(context) {
    const allowList = new AllowListMatcher(logicalIdAllowList.map((entry) => entry.path));

    if (allowList.matches(context.filename)) {
      return {};
    }

    const checker = new LogicalIdChecker(context);

    return {
      CallExpression: (node) => checker.checkCallExpression(node),
    };
  },
});

class LogicalIdChecker {
  private readonly context: LogicalIdContext;

  public constructor(context: LogicalIdContext) {
    this.context = context;
  }

  public checkCallExpression(node: TSESTree.CallExpression): void {
    if (node.callee.type !== AST_NODE_TYPES.MemberExpression || this.nameOf(node.callee) !== 'overrideLogicalId') {
      return;
    }

    if (!this.isInsideStackClass(node)) {
      this.context.report({ node, messageId: 'logicalId' });
    }
  }

  private isInsideStackClass(node: TSESTree.Node): boolean {
    let ancestor: TSESTree.Node | null | undefined = node.parent;

    while (ancestor) {
      if (ancestor.type === AST_NODE_TYPES.ClassDeclaration && ancestor.superClass !== null) {
        const superName = this.nameOf(ancestor.superClass);

        if (superName !== undefined && stackClassNames.test(superName)) {
          return true;
        }
      }

      ancestor = ancestor.parent;
    }

    return false;
  }

  private nameOf(node: TSESTree.Node): string | undefined {
    if (node.type === AST_NODE_TYPES.Identifier) {
      return node.name;
    }

    if (node.type === AST_NODE_TYPES.MemberExpression && node.property.type === AST_NODE_TYPES.Identifier) {
      return node.property.name;
    }

    return undefined;
  }
}
