import { App, type Stack }                  from 'aws-cdk-lib';
import { Command, Option }                  from 'clipanion';
import * as fileSystem                      from 'node:fs/promises';
import * as path                            from 'node:path';

import { StandaloneStackFactory }           from '../stacks/standalone-stack-factory';
import { type JsonObject, parseJsonObject } from '../utils/json-value';

/**
 * Base class of the build-stack subcommands. Each subcommand names its stack and template file; this
 * class synthesizes that stack from the standalone factory and writes its template as formatted JSON.
 * The `--out-dir` has no default, so the caller always names where the template goes.
 */
export abstract class BuildStackCommand extends Command {
  outDir = Option.String('--out-dir', {
    required:    true,
    description: 'Folder the template is written into; created when missing. Pass an absolute path. Required, given once.',
  });

  protected abstract readonly templateFileName: string;

  async execute(): Promise<void> {
    const app      = new App();
    const stack    = this.createStack(this.createFactory(), app);
    const template = this.synthesizeTemplate(app, stack);
    const filePath = await this.writeTemplate(template);

    this.context.stdout.write(`Written: ${filePath}\n`);
  }

  /** Creates the stack this subcommand builds, in the given app. */
  protected abstract createStack(factory: StandaloneStackFactory, app: App): Stack;

  /**
   * Reads the environment the entry owns: the account and region fall back to the values the template
   * has always been built with when no environment is set. The cognito stack gets no environment.
   */
  private createFactory(): StandaloneStackFactory {
    const account = process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000';
    const region  = process.env.CDK_DEFAULT_REGION ?? 'eu-west-1';
    return new StandaloneStackFactory('Mailbox', { account, region }, undefined);
  }

  private synthesizeTemplate(app: App, stack: Stack): JsonObject {
    const artifact = app.synth().getStackArtifact(stack.artifactId);
    return parseJsonObject(JSON.stringify(artifact.template), `Synthesized template of ${stack.stackName}`);
  }

  private async writeTemplate(template: JsonObject): Promise<string> {
    await fileSystem.mkdir(this.outDir, { recursive: true });

    const filePath = path.join(this.outDir, this.templateFileName);
    await fileSystem.writeFile(filePath, JSON.stringify(template, null, 2) + '\n', 'utf8');
    return filePath;
  }
}
