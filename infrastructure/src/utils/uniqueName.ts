import { Environment } from 'aws-cdk-lib';
import * as crypto from 'crypto';

export function makeUnique(stackname: string, env: Environment, ...parts: string[]) {
  let hash = crypto.createHash('md5');
  hash.update(parts.join(''));

  const result = (parts.join('') + hash.digest('hex').slice(0, 10).toLowerCase()).replace(/[-_,.]/, '');

  hash = crypto.createHash('md5');
  hash.update(stackname);
  hash.update(env.account ?? '');
  hash.update(env.region ?? '');
  const stackHash = hash.digest('hex').slice(0, 10).toLowerCase();

  const maxLength = 42 - stackname.length;

  const output = stackname + result.slice(Math.max(0, result.length - maxLength)) + stackHash;
  return output;
}
