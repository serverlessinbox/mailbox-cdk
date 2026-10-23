import { AST_NODE_TYPES, AST_TOKEN_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule }                                                    from './create-rule';

// Aligns the `=` of consecutive single-statement declarations and assignments, and the
// values of consecutive key-value members of object literals, interfaces and type literals.
// A group is a run of members where each starts on the line directly after the previous one
// ends: a blank line, a comment line or a member that does not take part ends it. A group of
// one is left alone. Only the whitespace right before the `=` / after the `:` is rewritten.

type AlignMessageId = 'alignEquals' | 'alignValue';

type AlignContext = Readonly<TSESLint.RuleContext<AlignMessageId, []>>;

type AlignSpan = TSESTree.Comment | TSESTree.Token;

interface AlignEntry {
  node:        TSESTree.Node;
  reportToken: TSESTree.Token;
  messageId:   AlignMessageId;
  column:      number;
  gapStart:    number;
  gapEnd:      number;
}

interface AlignedPair {
  left:  TSESTree.Node;
  right: TSESTree.Node;
}

class AlignChecker {
  private readonly context: AlignContext;

  private readonly sourceCode: TSESLint.SourceCode;

  public constructor(context: AlignContext) {
    this.context    = context;
    this.sourceCode = context.sourceCode;
  }

  public checkStatements(statements: readonly TSESTree.Node[]): void {
    this.alignEntries(statements.map((statement) => this.equalsEntry(statement)));
  }

  public checkMembers(members: readonly TSESTree.Node[]): void {
    this.alignEntries(members.map((member) => this.valueEntry(member)));
  }

  private alignEntries(entries: (AlignEntry | null)[]): void {
    let group: AlignEntry[] = [];
    entries.forEach((entry) => {
      if (!entry || !this.continuesGroup(group, entry)) {
        this.alignIfGroup(group);
        group = [];
      }
      if (entry) {
        group.push(entry);
      }
    });
    this.alignIfGroup(group);
  }

  private continuesGroup(group: readonly AlignEntry[], entry: AlignEntry): boolean {
    const last = group[group.length - 1];

    return last === undefined || entry.node.loc.start.line === last.node.loc.end.line + 1;
  }

  private alignIfGroup(group: readonly AlignEntry[]): void {
    if (group.length > 1) {
      this.alignGroup(group);
    }
  }

  private alignGroup(group: readonly AlignEntry[]): void {
    const target = Math.max(...group.map((entry) => entry.column)) + 1;
    group.forEach((entry) => {
      const padding = ' '.repeat(target - entry.column);
      if (this.sourceCode.text.slice(entry.gapStart, entry.gapEnd) === padding) {
        return;
      }
      this.context.report({
        loc:       entry.reportToken.loc,
        messageId: entry.messageId,
        fix:       (fixer) => fixer.replaceTextRange([entry.gapStart, entry.gapEnd], padding),
      });
    });
  }

  private equalsEntry(statement: TSESTree.Node): AlignEntry | null {
    const pair = this.assignedPair(statement);
    if (!pair) {
      return null;
    }
    const equals = this.sourceCode.getFirstTokenBetween(pair.left, pair.right, (token) => this.isPunctuator(token, '='));
    if (!equals || equals.loc.start.line !== statement.loc.start.line) {
      return null;
    }
    const before = this.sourceCode.getTokenBefore(equals, { includeComments: true });
    if (!before) {
      return null;
    }

    return this.entryFor(statement, equals, before, equals, 'alignEquals');
  }

  private valueEntry(member: TSESTree.Node): AlignEntry | null {
    const colon = this.colonOf(member);
    if (!colon || colon.loc.start.line !== member.loc.start.line) {
      return null;
    }
    const after = this.sourceCode.getTokenAfter(colon, { includeComments: true });
    if (!after) {
      return null;
    }

    return this.entryFor(member, colon, colon, after, 'alignValue');
  }

  private assignedPair(statement: TSESTree.Node): AlignedPair | null {
    const declaration = statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;
    if (declaration?.type === AST_NODE_TYPES.VariableDeclaration && declaration.declarations.length === 1) {
      const [declarator] = declaration.declarations;

      return declarator.init ? { left: declarator.id, right: declarator.init } : null;
    }
    if (statement.type === AST_NODE_TYPES.ExpressionStatement && statement.expression.type === AST_NODE_TYPES.AssignmentExpression && statement.expression.operator === '=') {
      return { left: statement.expression.left, right: statement.expression.right };
    }

    return null;
  }

  private colonOf(member: TSESTree.Node): TSESTree.Token | null {
    if (member.type === AST_NODE_TYPES.Property && member.kind === 'init' && !member.shorthand && !member.method) {
      return this.sourceCode.getFirstTokenBetween(member.key, member.value, (token) => this.isPunctuator(token, ':'));
    }
    if (member.type === AST_NODE_TYPES.TSPropertySignature && member.typeAnnotation) {
      return this.sourceCode.getFirstTokenBetween(member.key, member.typeAnnotation.typeAnnotation, (token) => this.isPunctuator(token, ':'));
    }

    return null;
  }

  private entryFor(node: TSESTree.Node, reportToken: TSESTree.Token, gapStart: AlignSpan, gapEnd: AlignSpan, messageId: AlignMessageId): AlignEntry | null {
    if (gapStart.loc.end.line !== gapEnd.loc.start.line) {
      return null;
    }

    return {
      node,
      reportToken,
      messageId,
      column:   gapStart.loc.end.column,
      gapStart: gapStart.range[1],
      gapEnd:   gapEnd.range[0],
    };
  }

  private isPunctuator(token: TSESTree.Token, value: string): boolean {
    return token.type === AST_TOKEN_TYPES.Punctuator && token.value === value;
  }
}

export const align = createRule({
  name:           'align',
  meta:           {
    type:     'layout',
    fixable:  'whitespace',
    docs:     {
      description: 'align = and : in groups of consecutive lines',
    },
    schema:   [],
    messages: {
      alignEquals: 'Align this "=" with the declarations and assignments on the lines directly above and below.',
      alignValue:  'Align this value with the members on the lines directly above and below.',
    },
  },
  defaultOptions: [],
  create(context) {
    const checker = new AlignChecker(context);

    return {
      Program:          (node) => checker.checkStatements(node.body),
      BlockStatement:   (node) => checker.checkStatements(node.body),
      StaticBlock:      (node) => checker.checkStatements(node.body),
      TSModuleBlock:    (node) => checker.checkStatements(node.body),
      ObjectExpression: (node) => checker.checkMembers(node.properties),
      TSInterfaceBody:  (node) => checker.checkMembers(node.body),
      TSTypeLiteral:    (node) => checker.checkMembers(node.members),
    };
  },
});
