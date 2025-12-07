import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import * as path from 'path';

export interface EdgeFunctionProps extends Omit<cloudfront.experimental.EdgeFunctionProps, 'code' | 'handler' | 'runtime'> {
  /**
   * Path to the TypeScript entry file
   */
  entry: string;
  
  /**
   * The name of the exported handler function (default: 'handler')
   */
  handler?: string;
  
  /**
   * External modules to exclude from bundling (default: ['@aws-sdk/*'])
   */
  externalModules?: string[];
  
  /**
   * Whether to minify the output (default: true)
   */
  minify?: boolean;
}

/**
 * Creates a Lambda@Edge function with local esbuild bundling.
 * Uses Yarn PnP to resolve dependencies without Docker.
 * 
 * @example
 * ```ts
 * const edgeFunction = createEdgeFunction(this, 'MyEdgeFunction', {
 *   entry: path.join(__dirname, 'edge-functions/my-function.ts'),
 *   environment: {
 *     TABLE_NAME: table.tableName,
 *   },
 * });
 * ```
 */
export function createEdgeFunction(
  scope: Construct,
  id: string,
  props: EdgeFunctionProps
): cloudfront.experimental.EdgeFunction {
  const {
    entry,
    handler = 'handler',
    externalModules = ['@aws-sdk/*'],
    minify = true,
    ...edgeFunctionProps
  } = props;

  return new cloudfront.experimental.EdgeFunction(scope, id, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: `index.${handler}`,
    code: lambda.Code.fromAsset(path.dirname(entry), {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        local: {
          tryBundle(outputDir: string) {
            const outfile = path.join(outputDir, 'index.js');
            
            // Use esbuild from Yarn PnP
            const esbuild = require('esbuild');
            esbuild.buildSync({
              entryPoints: [entry],
              bundle: true,
              platform: 'node',
              target: 'node20',
              external: externalModules,
              outfile,
              minify,
              sourcemap: false,
              format: 'cjs',
            });
            
            return true;
          },
        },
      },
    }),
    ...edgeFunctionProps,
  });
}
