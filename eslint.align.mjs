// Aligns the `=` of consecutive single-statement declarations and assignments, and the
// values of consecutive key-value members of object literals, interfaces and type literals.
// A group is a run of members where each starts on the line directly after the previous one
// ends: a blank line, a comment line or a member that does not take part ends it. A group of
// one is left alone. Only the whitespace right before the `=` / after the `:` is rewritten.

const isEqualsToken = (token) => token.type === 'Punctuator' && token.value === '=';
const isColonToken = (token) => token.type === 'Punctuator' && token.value === ':';

const declaratorOf = (statement) => {
  const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
  if (declaration && declaration.type === 'VariableDeclaration' && declaration.declarations.length === 1 && declaration.declarations[0].init) {
    return declaration.declarations[0];
  }

  return null;
};

const isEqualsAssignment = (statement) => statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' && statement.expression.operator === '=';

export const alignRule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'align = and : in groups of consecutive lines',
    },
    schema: [],
    messages: {
      alignEquals: 'Align this "=" with the declarations and assignments on the lines directly above and below.',
      alignValue: 'Align this value with the members on the lines directly above and below.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    // The gap is the whitespace between gapStartToken and gapEndToken; `column` is where the
    // left side ends, so the right side starts one column after the longest left side.
    const entryFor = (node, reportToken, gapStartToken, gapEndToken, messageId) => {
      if (gapStartToken.loc.end.line !== gapEndToken.loc.start.line) {
        return null;
      }

      return {
        node,
        reportToken,
        messageId,
        column: gapStartToken.loc.end.column,
        gapStart: gapStartToken.range[1],
        gapEnd: gapEndToken.range[0],
      };
    };

    const equalsEntry = (statement) => {
      const declarator = declaratorOf(statement);
      let left;
      let right;
      if (declarator) {
        left = declarator.id;
        right = declarator.init;
      } else if (isEqualsAssignment(statement)) {
        left = statement.expression.left;
        right = statement.expression.right;
      } else {
        return null;
      }

      const equals = sourceCode.getFirstTokenBetween(left, right, isEqualsToken);
      if (!equals || equals.loc.start.line !== statement.loc.start.line) {
        return null;
      }

      const before = sourceCode.getTokenBefore(equals, { includeComments: true });

      return entryFor(statement, equals, before, equals, 'alignEquals');
    };

    const valueEntry = (member) => {
      let colon;
      if (member.type === 'Property' && member.kind === 'init' && !member.shorthand && !member.method) {
        colon = sourceCode.getFirstTokenBetween(member.key, member.value, isColonToken);
      } else if (member.type === 'TSPropertySignature' && member.typeAnnotation) {
        colon = sourceCode.getFirstTokenBetween(member.key, member.typeAnnotation.typeAnnotation, isColonToken);
      }
      if (!colon || colon.loc.start.line !== member.loc.start.line) {
        return null;
      }

      const after = sourceCode.getTokenAfter(colon, { includeComments: true });

      return entryFor(member, colon, colon, after, 'alignValue');
    };

    const alignGroup = (group) => {
      const target = Math.max(...group.map((entry) => entry.column)) + 1;
      group.forEach((entry) => {
        const padding = ' '.repeat(target - entry.column);
        if (sourceCode.text.slice(entry.gapStart, entry.gapEnd) === padding) {
          return;
        }
        context.report({
          loc: entry.reportToken.loc,
          messageId: entry.messageId,
          fix: (fixer) => fixer.replaceTextRange([entry.gapStart, entry.gapEnd], padding),
        });
      });
    };

    const alignEntries = (entries) => {
      let group = [];
      const flush = () => {
        if (group.length > 1) {
          alignGroup(group);
        }
        group = [];
      };
      entries.forEach((entry) => {
        if (!entry) {
          flush();

          return;
        }
        const last = group[group.length - 1];
        if (last && entry.node.loc.start.line !== last.node.loc.end.line + 1) {
          flush();
        }
        group.push(entry);
      });
      flush();
    };

    const checkStatements = (node) => alignEntries(node.body.map(equalsEntry));
    const checkMembers = (members) => alignEntries(members.map(valueEntry));

    return {
      Program: checkStatements,
      BlockStatement: checkStatements,
      StaticBlock: checkStatements,
      TSModuleBlock: checkStatements,
      ObjectExpression: (node) => checkMembers(node.properties),
      TSInterfaceBody: (node) => checkMembers(node.body),
      TSTypeLiteral: (node) => checkMembers(node.members),
    };
  },
};
