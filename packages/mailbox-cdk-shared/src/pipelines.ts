/**
 * The pipeline a Lambda belongs to — selects which shared CloudWatch log group it writes to.
 * Every `GoLambda2Props` / `TypeScriptLambdaProps` consumer declares exactly one.
 */
export type Pipeline = 'infra' | 'mail-in' | 'mail-out' | 'jmap' | 'admin' | 'audit';
