// Lays out the names of one named import in lines that each end before the lane column. It works
// on column numbers and text only, so the rule can measure an import before it touches the source.

export interface ImportParts {
  indentColumn: number;
  head:         string;
  names:        string[];
}

export class ImportPacker {
  private readonly laneColumn: number;

  public constructor(laneColumn: number) {
    this.laneColumn = laneColumn;
  }

  public singleLineEnd(parts: ImportParts): number {
    return parts.indentColumn + `${parts.head} ${parts.names.join(', ')} }`.length;
  }

  public isWide(parts: ImportParts): boolean {
    return this.singleLineEnd(parts) + 1 > this.laneColumn;
  }

  public fitsLane(lines: readonly string[]): boolean {
    return lines.every((line) => line.length < this.laneColumn);
  }

  // Each line holds as many names as end before the lane. The head line starts with the head text,
  // continuation lines are indented two columns past the statement, and the last name is followed
  // by the closing brace on its own line.
  public pack(parts: ImportParts): string[] {
    const indent = ' '.repeat(parts.indentColumn);

    const continuation = `${indent}  `;

    const tokens = this.tokensOf(parts.names);

    const lines: string[] = [];

    let prefix = `${indent}${parts.head} `;

    let lineTokens: string[] = [];

    for (const token of tokens) {
      if (this.lineOf(prefix, [...lineTokens, token]).length < this.laneColumn) {
        lineTokens = [...lineTokens, token];
      } else {
        lines.push(this.lineOf(prefix, lineTokens));
        prefix     = continuation;
        lineTokens = [token];
      }
    }
    lines.push(this.lineOf(prefix, lineTokens));

    return lines;
  }

  private tokensOf(names: readonly string[]): string[] {
    return names.map((name, index) => (index === names.length - 1 ? `${name} }` : `${name},`));
  }

  private lineOf(prefix: string, tokens: readonly string[]): string {
    return tokens.length === 0 ? prefix.trimEnd() : `${prefix}${tokens.join(' ')}`;
  }
}
