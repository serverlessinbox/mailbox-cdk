/** A switch of a stack operation: a boolean, or the text CloudFormation sends for one. */
type StackDeployerFlag = boolean | 'true' | 'false';

/** A map of text values; a value that is undefined is not passed on. */
interface StackDeployerTextMap {
  readonly [key: string]: string | undefined;
}

/** The properties of the custom resource that deploys one CloudFormation stack, as the construct writes them: plain strings. */
export interface StackDeployerProperties {
  readonly ServiceToken?:          string;
  readonly stackName:              string;
  readonly templateUrl?:           string;
  readonly parameters?:            StackDeployerTextMap;
  readonly tags?:                  StackDeployerTextMap;
  readonly terminationProtection?: StackDeployerFlag;
  readonly region?:                string;
  readonly preserveOnDelete?:      StackDeployerFlag;
}
