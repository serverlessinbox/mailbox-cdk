import { AST_NODE_TYPES, type TSESLint, type TSESTree }    from '@typescript-eslint/utils';

import { AllowListMatcher }                                from '../model/allow-list-matcher';
import { iamAllowList }                                    from '../model/iam-allow-list';

import { createRule }                                      from './create-rule';

// R2: IAM statements are written only in resources/**, grants/** and the allow-listed files.

type IamMessageId = 'iamStatement';

type IamContext = Readonly<TSESLint.RuleContext<IamMessageId, []>>;

const iamMessage = 'G-model R2: IAM statements live in resources/** (a grant method of the defined resource), in the kit grants/** helpers, or in a file on the R2 allow-list in packages/eslint-plugin-mailbox/src/model/iam-allow-list.ts.';

const iamConstructors = new Set(['PolicyStatement', 'Policy']);
const iamMethods      = new Set(['addToRolePolicy', 'addToPrincipalPolicy']);
const coveredFolder   = /(^|\/)packages\/[^/]+\/src\/(resources|grants)\//;

export const iamStatementHome = createRule({
  name:           'iam-statement-home',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'allow IAM statements only in resources/, grants/ and the R2 allow-list',
    },
    schema:   [],
    messages: {
      iamStatement: iamMessage,
    },
  },
  defaultOptions: [],
  create(context) {
    const allowList  = new AllowListMatcher(iamAllowList.map((entry) => entry.path));
    const normalized = context.filename.replace(/\\/g, '/');

    if (coveredFolder.test(normalized) || allowList.matches(context.filename)) {
      return {};
    }

    const checker = new IamStatementChecker(context);

    return {
      NewExpression:  (node) => checker.checkNewExpression(node),
      CallExpression: (node) => checker.checkCallExpression(node),
    };
  },
});

class IamStatementChecker {
  private readonly context: IamContext;

  public constructor(context: IamContext) {
    this.context = context;
  }

  public checkNewExpression(node: TSESTree.NewExpression): void {
    const name = this.nameOf(node.callee);

    if (name !== undefined && iamConstructors.has(name)) {
      this.context.report({ node, messageId: 'iamStatement' });
    }
  }

  public checkCallExpression(node: TSESTree.CallExpression): void {
    if (node.callee.type !== AST_NODE_TYPES.MemberExpression) {
      return;
    }

    const name = this.nameOf(node.callee);

    if (name !== undefined && iamMethods.has(name)) {
      this.context.report({ node, messageId: 'iamStatement' });
    }
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
