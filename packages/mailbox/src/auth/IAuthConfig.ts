import { SecretValue } from "aws-cdk-lib";
import { Permission } from "../utils/jmap-scopes";

export interface IGenerateClientParams {
  name: string;
  groups: string[];
  permissions: Permission[];
  callbackUrls: string[];
  logoutUrls: string[];
}

export interface IAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret?: SecretValue;
  readonly requestScopeList: string[];
  readonly groups: string[];
}

export interface IAuthConfig {
  readonly issuer: string;  
  readonly clientIds: string[];
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint: string;
  readonly authMethod: 'header' | 'form';
  readonly usePkce: boolean;
  readonly scopeMap: { [key: string]: Permission[] };

  generateClient(params: IGenerateClientParams) : IAuthClientConfig;
}
