import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path                      from 'node:path';

import { errorMessage }               from '../utils/error-message';
import { parseJsonObject }            from '../utils/json-value';
import type { JsonObject }            from '../utils/json-value';

import type { StackTemplate }         from './stack-template';

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The folder that keeps captured baselines: one subfolder per label, one
 * `<stack>.template.json` file per stack inside it.
 */
export class BaselineStore {
  constructor(private readonly baselineRoot: string) {}

  /** Writes each template as formatted JSON into the folder of `label`, replacing a file of the same stack. Returns the paths written. */
  async write(label: string, templates: StackTemplate[]): Promise<string[]> {
    const directory = this.labelDirectory(label);
    await mkdir(directory, { recursive: true });

    const files: string[] = [];
    for (const { stackName, template } of templates) {
      const file = this.templateFile(label, stackName);
      await writeFile(file, `${JSON.stringify(template, null, 2)}\n`);
      files.push(file);
    }
    return files;
  }

  /** A missing baseline rejects with an error naming the file and the capture command; invalid JSON rejects naming the file. */
  async readStackTemplate(label: string, stackName: string): Promise<JsonObject> {
    const file = this.templateFile(label, stackName);
    const text = await this.readBaselineFile(file);
    return parseJsonObject(text, `Baseline template ${file}`);
  }

  private async readBaselineFile(file: string): Promise<string> {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read baseline template ${file}; capture it first with "yarn template-baseline capture": ${errorMessage(error)}`);
    }
  }

  private templateFile(label: string, stackName: string): string {
    return path.join(this.labelDirectory(label), `${stackName}.template.json`);
  }

  /** A label becomes a folder name, so anything that could leave the baseline folder is rejected. */
  private labelDirectory(label: string): string {
    if (!LABEL_PATTERN.test(label)) {
      throw new Error(`Invalid label "${label}": use letters, digits, dot, underscore and dash, starting with a letter or digit.`);
    }
    return path.join(this.baselineRoot, label);
  }
}
