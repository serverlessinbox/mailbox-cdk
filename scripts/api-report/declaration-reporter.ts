import * as path       from 'node:path';
import * as typescript from 'typescript';

const VIRTUAL_OUT_DIR    = '/api-report-out';
const ENTRY_DECLARATION  = 'index.d.ts';
const RELATIVE_REFERENCE = /\sfrom\s+'(\.[^']*)'/g;

/**
 * Produces the public-surface report of a non-jsii TypeScript package: the declarations the build emits for
 * its entry point and for every file the entry point reaches, without comments, in a fixed order. Two reports
 * differ exactly when the declared surface differs. The report is built in memory; nothing is written to the
 * package.
 */
export class DeclarationReporter {
  constructor(private readonly packageDir: string) {}

  public report(): string {
    const declarations = this.emitDeclarations();

    return this.reachableFiles(declarations)
      .map((file) => `// ${file}\n${declarations.get(file)}`)
      .join('\n');
  }

  private emitDeclarations(): Map<string, string> {
    const parsed = this.parseBuildConfig();

    const options: typescript.CompilerOptions = {
      ...parsed.options,
      declaration:         true,
      emitDeclarationOnly: true,
      noEmit:              false,
      noEmitOnError:       false,
      incremental:         false,
      removeComments:      true,
      outDir:              VIRTUAL_OUT_DIR,
      rootDir:             path.join(this.packageDir, 'src'),
    };
    const program                             = typescript.createProgram({ rootNames: parsed.fileNames, options });

    this.assertNoErrors(typescript.getPreEmitDiagnostics(program));

    const declarations = new Map<string, string>();
    program.emit(undefined, (fileName, text) => {
      declarations.set(path.relative(VIRTUAL_OUT_DIR, fileName), text);
    }, undefined, true);

    return declarations;
  }

  private parseBuildConfig(): typescript.ParsedCommandLine {
    const configPath = path.join(this.packageDir, 'tsconfig.build.json');
    const config     = typescript.readConfigFile(configPath, typescript.sys.readFile);

    if (config.error !== undefined) {
      throw new Error(`Cannot read ${configPath}: ${typescript.flattenDiagnosticMessageText(config.error.messageText, '\n')}`);
    }

    return typescript.parseJsonConfigFileContent(config.config, typescript.sys, this.packageDir);
  }

  private assertNoErrors(diagnostics: readonly typescript.Diagnostic[]): void {
    if (diagnostics.length > 0) {
      throw new Error(`The package does not compile:\n${typescript.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory:  () => this.packageDir,
        getNewLine:           () => '\n',
      })}`);
    }
  }

  private reachableFiles(declarations: Map<string, string>): string[] {
    const reached = new Set<string>();
    const pending = [ENTRY_DECLARATION];

    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      if (reached.has(file)) {
        continue;
      }
      reached.add(file);

      const text = declarations.get(file);

      if (text === undefined) {
        throw new Error(`The build emitted no declaration file ${file}, which the entry point reaches`);
      }

      for (const match of text.matchAll(RELATIVE_REFERENCE)) {
        pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), `${match[1]}.d.ts`)));
      }
    }

    return [...reached].sort();
  }
}
