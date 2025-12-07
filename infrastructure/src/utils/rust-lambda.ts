import { Function, FunctionOptions, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { resolve } from 'path';
import * as path from 'path';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';

export interface RustLambdaProps extends FunctionOptions {
  handlerName: string;
}

/**
 * RustLambda construct builds Rust Lambda functions using cargo
 * Similar to GoLambda, it compiles Rust code at CDK deployment time
 * Outputs a bootstrap binary compatible with PROVIDED_AL2 runtime
 * Uses incremental builds: only rebuilds if source files have changed
 */
export class RustLambda extends Function {
  private static computeSourceHash(lambdaDir: string): string {
    const hash = crypto.createHash('sha256');
    
    // Hash Cargo.toml and Cargo.lock
    const cargoTomlPath = path.join(lambdaDir, 'Cargo.toml');
    const cargoLockPath = path.join(lambdaDir, 'Cargo.lock');
    
    if (fs.existsSync(cargoTomlPath)) {
      hash.update(fs.readFileSync(cargoTomlPath));
    }
    if (fs.existsSync(cargoLockPath)) {
      hash.update(fs.readFileSync(cargoLockPath));
    }
    
    // Hash all .rs files in src/
    const srcDir = path.join(lambdaDir, 'src');
    if (fs.existsSync(srcDir)) {
      const rsFiles = fs.readdirSync(srcDir)
        .filter(f => f.endsWith('.rs'))
        .sort();
      for (const file of rsFiles) {
        hash.update(fs.readFileSync(path.join(srcDir, file)));
      }
    }
    
    return hash.digest('hex');
  }

  constructor(scope: Construct, id: string, props: RustLambdaProps) {
    const lambdaDir = resolve(__dirname, '../../../lambdas', props.handlerName);
    
    // Build Rust Lambda at CDK synthesis time
    const buildDir = path.join(lambdaDir, 'target', 'release');
    
    // Get the binary name from Cargo.toml (package name)
    const cargoToml = fs.readFileSync(path.join(lambdaDir, 'Cargo.toml'), 'utf-8');
    const nameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
    const binaryName = nameMatch ? nameMatch[1].replace(/-/g, '_') : props.handlerName.replace(/-/g, '_');
    
    // Only build if source files have changed
    const hashFile = path.join(buildDir, '.source-hash');
    const currentHash = RustLambda.computeSourceHash(lambdaDir);
    let lastHash = '';
    
    if (fs.existsSync(hashFile)) {
      lastHash = fs.readFileSync(hashFile, 'utf-8').trim();
    }
    
    const needsBuild = currentHash !== lastHash;
    
    try {
      if (needsBuild) {
        console.log(`Building Rust Lambda: ${props.handlerName}`);
        execSync(`cargo build --release --manifest-path=${path.join(lambdaDir, 'Cargo.toml')}`, {
          stdio: 'inherit',
        });
        
        // Ensure build directory exists and write the hash
        if (!fs.existsSync(buildDir)) {
          fs.mkdirSync(buildDir, { recursive: true });
        }
        fs.writeFileSync(hashFile, currentHash);
        console.log(`✓ ${props.handlerName} built successfully`);
      } else {
        console.log(`⊘ ${props.handlerName} unchanged, using cached build`);
      }
    } catch (error) {
      throw new Error(`Failed to build Rust Lambda ${props.handlerName}: ${error}`);
    }

    super(scope, id, {
      architecture: Architecture.ARM_64,
      runtime: Runtime.PROVIDED_AL2,
      code: Code.fromAsset(buildDir, {
        // Only include the binary, not the entire target directory
        assetHashType: require('aws-cdk-lib').AssetHashType.SOURCE,
      }),
      handler: 'bootstrap', // For PROVIDED runtimes, the handler is the bootstrap binary
      memorySize: 256,
      logGroup: new LogGroup(scope, `${id}-LogGroup`, {
        retention: RetentionDays.ONE_MONTH,
      }),
      ...props,
    });
  }
}
