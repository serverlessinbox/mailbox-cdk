import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule }                                   from './create-rule';
import { ImportPacker, type ImportParts }               from './import-packer';

type ImportLayoutMessageId = 'alignImport';

type ImportLayoutContext = Readonly<TSESLint.RuleContext<ImportLayoutMessageId, []>>;

// One import that takes part in lane alignment: its target lines, with absolute columns, where its
// `from` starts, and whether its names alone reach past the lane.
interface ImportEntry {
  node:      TSESTree.ImportDeclaration;
  fromStart: number;
  lines:     string[];
  wide:      boolean;
}

const IMPORT_LANE_COLUMN = 80;

export const importLayout = createRule({
  name:           'import-layout',
  meta:           {
    type:     'layout',
    fixable:  'whitespace',
    docs:     {
      description: 'lay out imports within a lane column and align "from" across each run of adjacent imports',
    },
    schema:   [],
    messages: {
      alignImport: `Lay out this import within column ${IMPORT_LANE_COLUMN} and align "from" with the other imports of its run.`,
    },
  },
  defaultOptions: [],
  create(context) {
    const checker = new ImportLayoutChecker(context, new ImportPacker(IMPORT_LANE_COLUMN));

    return {
      Program:       (node) => checker.checkStatements(node.body),
      TSModuleBlock: (node) => checker.checkStatements(node.body),
    };
  },
});

// Aligns `from` across each run of adjacent imports of one body. Blank lines do not end a run; a
// statement that is not an import, an import without specifiers and an exempt import do. An import is
// exempt when it has a comment inside, when its `from` is not on the line of the token before it, or
// when its lines cannot end before the lane; exempt imports are left as written. A multi-line import
// whose lines all end before the lane keeps its shape, and only a line that passes the lane is
// reflowed into the packed layout. This checker never unwraps an import.
class ImportLayoutChecker {
  private readonly context: ImportLayoutContext;

  private readonly packer: ImportPacker;

  private readonly sourceCode: TSESLint.SourceCode;

  public constructor(context: ImportLayoutContext, packer: ImportPacker) {
    this.context    = context;
    this.packer     = packer;
    this.sourceCode = context.sourceCode;
  }

  public checkStatements(statements: readonly TSESTree.ProgramStatement[]): void {
    const entries = statements.map((statement) => this.entryFor(statement));
    for (const run of this.runsOf(entries)) {
      const lane = this.laneOf(run);
      for (const entry of run) {
        this.report(entry, lane);
      }
    }
  }

  private entryFor(statement: TSESTree.ProgramStatement): ImportEntry | null {
    if (statement.type !== AST_NODE_TYPES.ImportDeclaration || statement.specifiers.length === 0 || this.hasCommentInside(statement)) {
      return null;
    }
    const fromToken = this.sourceCode.getTokenBefore(statement.source);
    const lastToken = fromToken ? this.sourceCode.getTokenBefore(fromToken) : null;
    if (!fromToken || !lastToken || fromToken.loc.start.line !== lastToken.loc.end.line) {
      return null;
    }
    const parts = this.partsOf(statement);
    const lines = this.layoutOf(statement, lastToken, parts);
    if (!lines) {
      return null;
    }

    return { node: statement, fromStart: fromToken.range[0], lines, wide: parts !== null && this.packer.isWide(parts) };
  }

  private layoutOf(statement: TSESTree.ImportDeclaration, lastToken: TSESTree.Token, parts: ImportParts | null): string[] | null {
    const kept = this.verbatimLines(statement, lastToken);
    if (this.packer.fitsLane(kept)) {
      return kept;
    }
    if (parts === null) {
      return null;
    }
    const packed = this.packer.pack(parts);

    return this.packer.fitsLane(packed) ? packed : null;
  }

  private verbatimLines(statement: TSESTree.ImportDeclaration, lastToken: TSESTree.Token): string[] {
    const indent = ' '.repeat(statement.loc.start.column);
    const lines  = this.sourceCode.text.slice(statement.range[0], lastToken.range[1]).split('\n');

    return lines.map((line, index) => (index === 0 ? `${indent}${line}` : line));
  }

  private partsOf(statement: TSESTree.ImportDeclaration): ImportParts | null {
    const specifiers = this.namedSpecifiersOf(statement);

    const open = specifiers.length === 0 ? null : this.sourceCode.getTokenBefore(specifiers[0]);
    if (!open) {
      return null;
    }

    return {
      indentColumn: statement.loc.start.column,
      head:         this.sourceCode.text.slice(statement.range[0], open.range[1]),
      names:        specifiers.map((specifier) => this.sourceCode.getText(specifier)),
    };
  }

  private namedSpecifiersOf(node: TSESTree.ImportDeclaration): TSESTree.ImportSpecifier[] {
    return node.specifiers.filter((specifier): specifier is TSESTree.ImportSpecifier => specifier.type === AST_NODE_TYPES.ImportSpecifier);
  }

  private hasCommentInside(node: TSESTree.ImportDeclaration): boolean {
    return this.sourceCode.getCommentsInside(node).length > 0;
  }

  private runsOf(entries: readonly (ImportEntry | null)[]): ImportEntry[][] {
    const runs: ImportEntry[][] = [];

    let run: ImportEntry[] = [];
    for (const entry of entries) {
      if (entry) {
        run.push(entry);
      } else {
        if (run.length > 0) {
          runs.push(run);
        }
        run = [];
      }
    }
    if (run.length > 0) {
      runs.push(run);
    }

    return runs;
  }

  private laneOf(run: readonly ImportEntry[]): number | null {
    if (run.length === 1) {
      return null;
    }
    if (run.some((entry) => entry.wide)) {
      return IMPORT_LANE_COLUMN;
    }

    return Math.max(...run.map((entry) => this.widestLineEnd(entry.lines))) + 1;
  }

  private report(entry: ImportEntry, lane: number | null): void {
    const padding = lane === null ? 1 : lane - this.lastLineEnd(entry.lines);
    const desired = `${this.textOf(entry)}${' '.repeat(padding)}`;
    const start   = entry.node.range[0];
    if (this.sourceCode.text.slice(start, entry.fromStart) === desired) {
      return;
    }
    this.context.report({
      node:      entry.node,
      messageId: 'alignImport',
      fix:       (fixer) => fixer.replaceTextRange([start, entry.fromStart], desired),
    });
  }

  private textOf(entry: ImportEntry): string {
    return entry.lines.join('\n').slice(entry.node.loc.start.column);
  }

  private lastLineEnd(lines: readonly string[]): number {
    return lines[lines.length - 1].length;
  }

  private widestLineEnd(lines: readonly string[]): number {
    return Math.max(...lines.map((line) => line.length));
  }
}
