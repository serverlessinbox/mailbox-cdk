// The defined resource kinds and the CDK classes each one owns. A covered class is created only in the
// resources/ folder of its own kind.

export interface CoveredKind {
  readonly folder:     string;
  readonly classNames: readonly string[];
  // The member form (`lambda.Function`) is covered only through these namespace identifiers, because
  // other services have a class of the same name. The bare form is covered regardless.
  readonly namespaces?: readonly string[];
}

export const coveredKinds: readonly CoveredKind[] = [
  { folder: 'tables',    classNames: ['Table', 'StackNamedTable', 'BaseTable'] },
  { folder: 'queues',    classNames: ['Queue', 'BaseQueue'] },
  { folder: 'buckets',   classNames: ['Bucket', 'StackNamedBucket'] },
  { folder: 'topics',    classNames: ['Topic'] },
  { folder: 'events',    classNames: ['Rule', 'EventSourceMapping', 'LambdaFunction'] },
  { folder: 'workflows', classNames: ['StateMachine'] },
  { folder: 'lambdas',   classNames: ['Function'], namespaces: ['lambda', 'aws_lambda'] },
];
