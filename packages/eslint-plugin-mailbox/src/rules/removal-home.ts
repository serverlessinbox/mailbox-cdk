import { AST_NODE_TYPES, type TSESLint, type TSESTree }    from '@typescript-eslint/utils';

import { createRule }                                      from './create-rule';

// R5: a resource-removal implementation lives in platform/ops/sweeper/ only. A class that implements
// IResourceRemoval (bare or qualified), or a file that defines grantStatements() next to a PolicyStatement,
// is reported outside that folder.

type RemovalMessageId = 'bareRemoval' | 'qualifiedRemoval' | 'statementHolder';

type RemovalContext = Readonly<TSESLint.RuleContext<RemovalMessageId, []>>;

type MemberNode = TSESTree.MethodDefinition | TSESTree.TSAbstractMethodDefinition | TSESTree.TSMethodSignature | TSESTree.Property;

const sweeperFolder    = /(^|\/)packages\/mailbox\/src\/platform\/ops\/sweeper\//;
const removalInterface = 'IResourceRemoval';
const statementMethod  = 'grantStatements';
const statementType    = 'PolicyStatement';

export const removalHome = createRule({
  name:           'removal-home',
  meta:           {
    type:     'problem',
    docs:     {
      description: 'allow resource-removal implementations only in platform/ops/sweeper/',
    },
    schema:   [],
    messages: {
      bareRemoval:      'G-model R5: a class implementing IResourceRemoval lives only in platform/ops/sweeper/.',
      qualifiedRemoval: 'G-model R5: a class implementing a qualified IResourceRemoval lives only in platform/ops/sweeper/.',
      statementHolder:  'G-model R5: a grantStatements() method next to a PolicyStatement lives only in platform/ops/sweeper/.',
    },
  },
  defaultOptions: [],
  create(context) {
    if (sweeperFolder.test(context.filename.replace(/\\/g, '/'))) {
      return {};
    }

    const checker = new RemovalChecker(context);

    return {
      TSClassImplements:          (node) => checker.checkImplements(node),
      MethodDefinition:           (node) => checker.recordMember(node),
      TSAbstractMethodDefinition: (node) => checker.recordMember(node),
      TSMethodSignature:          (node) => checker.recordMember(node),
      Property:                   (node) => checker.recordMember(node),
      Identifier:                 (node) => checker.recordIdentifier(node),
      'Program:exit':             (node) => checker.reportStatementHolder(node),
    };
  },
});

class RemovalChecker {
  private readonly context: RemovalContext;
  private definesStatementMethod = false;
  private namesStatementType = false;

  public constructor(context: RemovalContext) {
    this.context = context;
  }

  public checkImplements(node: TSESTree.TSClassImplements): void {
    const expression: TSESTree.Node = node.expression;

    if (expression.type === AST_NODE_TYPES.Identifier && expression.name === removalInterface) {
      this.context.report({ node, messageId: 'bareRemoval' });
    } else if (this.isQualifiedRemoval(expression)) {
      this.context.report({ node, messageId: 'qualifiedRemoval' });
    }
  }

  public recordMember(node: MemberNode): void {
    if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === statementMethod) {
      this.definesStatementMethod = true;
    }
  }

  public recordIdentifier(node: TSESTree.Identifier): void {
    if (node.name === statementType) {
      this.namesStatementType = true;
    }
  }

  public reportStatementHolder(program: TSESTree.Program): void {
    if (this.definesStatementMethod && this.namesStatementType) {
      this.context.report({ node: program, messageId: 'statementHolder' });
    }
  }

  private isQualifiedRemoval(expression: TSESTree.Node): boolean {
    if (expression.type === AST_NODE_TYPES.TSQualifiedName) {
      return expression.right.name === removalInterface;
    }

    if (expression.type === AST_NODE_TYPES.MemberExpression && expression.property.type === AST_NODE_TYPES.Identifier) {
      return expression.property.name === removalInterface;
    }

    return false;
  }
}
