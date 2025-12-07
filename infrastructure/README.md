# @mailbox/infrastructure

The AWS CDK infrastructure package for the mailbox application.

## Commands

- `yarn build` - Build TypeScript and Go Lambda functions
- `yarn build:ts` - Build TypeScript only
- `yarn build:lambdas` - Build Go Lambda functions only
- `yarn watch` - Watch TypeScript files for changes
- `yarn dev` - Alias for watch
- `yarn cdk` - Run CDK CLI commands
- `yarn deploy` - Deploy the stack
- `yarn synth` - Synthesize CloudFormation template

## Structure

- `src/` - TypeScript CDK source code
- `lib/` - Compiled TypeScript output
- `cdk.out/` - CDK synthesized CloudFormation templates