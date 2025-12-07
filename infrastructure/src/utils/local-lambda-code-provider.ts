import { Code } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { ILambdaCodeProvider } from './lambda-code-provider';

export interface LocalLambdaCodeProviderConfig {
  lambdasRepoPath: string;  // Path to mailbox-lambdas repo
  autoBuild?: boolean;      // Default: true
}

/**
 * Provides Lambda code by building from local mailbox-lambdas repository
 *
 * Automatically builds lambdas if release directory doesn't exist.
 * Useful for development and testing.
 */
export class LocalLambdaCodeProvider implements ILambdaCodeProvider {
  private config: LocalLambdaCodeProviderConfig;
  private builtLambdas: Set<string> = new Set();
  private tempDir: string;

  constructor(config: LocalLambdaCodeProviderConfig) {
    this.config = {
      autoBuild: true,
      ...config,
    };
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-provider-'));
  }

  getCode(lambdaId: string): Code {
    const lambdaDir = path.resolve(
      this.config.lambdasRepoPath,
      'modules/lambdas',
      lambdaId
    );

    const releaseDir = path.join(lambdaDir, 'release');

    if (!fs.existsSync(lambdaDir)) {
      throw new Error(
        `Lambda directory not found: ${lambdaDir}\n` +
        `Make sure lambdasRepoPath points to the mailbox-lambdas repository.`
      );
    }

    if (!fs.existsSync(releaseDir)) {
      if (this.config.autoBuild) {
        this.buildLambda(lambdaId, lambdaDir);
      } else {
        throw new Error(
          `Lambda release directory not found: ${releaseDir}\n` +
          `Run 'task build' in ${lambdaDir} or enable autoBuild.`
        );
      }
    }

    // Create a ZIP file with all contents of the release directory
    // This includes bootstrap binary, any .so libraries (like tantivy.so), etc.
    // Lambda expects all files at the root of the ZIP
    const bootstrapPath = path.join(releaseDir, 'bootstrap');
    if (!fs.existsSync(bootstrapPath)) {
      throw new Error(
        `Bootstrap binary not found at ${bootstrapPath}. ` +
        `Make sure 'task build' was successful.`
      );
    }

    // Ensure all files in release dir have proper permissions
    const files = fs.readdirSync(releaseDir);
    files.forEach(file => {
      const filePath = path.join(releaseDir, file);
      const stat = fs.statSync(filePath);
      // Make executables executable
      if (file === 'bootstrap' || file.endsWith('.so')) {
        if ((stat.mode & 0o111) === 0) {
          fs.chmodSync(filePath, stat.mode | 0o111);
        }
      }
    });

    return Code.fromAsset(releaseDir);
  }

  private buildLambda(lambdaId: string, lambdaDir: string): void {
    // Skip if already built in this synth
    if (this.builtLambdas.has(lambdaId)) {
      return;
    }

    console.log(`[LocalLambdaCodeProvider] Building ${lambdaId} for arm64/linux...`);

    try {
      execSync('task build', {
        cwd: lambdaDir,
        stdio: 'inherit',
        env: { ...process.env, GOOS: 'linux', GOARCH: 'arm64' },
      });
      console.log(`[LocalLambdaCodeProvider] ✓ Built ${lambdaId}`);
      this.builtLambdas.add(lambdaId);
    } catch (error) {
      throw new Error(`Failed to build lambda ${lambdaId}: ${error}`);
    }
  }
}
