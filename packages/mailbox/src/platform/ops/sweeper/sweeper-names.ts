/** The names of the sweeper's inline IAM policies. A deletion by name has nothing else to go on, so each name is defined once. */
export const SweeperPolicyNames = {
  executionPolicy: 'sweeper-execution-policy',
  workerPolicy:    'sweeper-worker-policy',
} as const;
