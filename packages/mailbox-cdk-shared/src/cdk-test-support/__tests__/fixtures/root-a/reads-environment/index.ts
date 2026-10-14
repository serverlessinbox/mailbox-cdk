const flag = process.env.FIXTURE_FLAG;

export const handler = async (): Promise<{ readonly serverlessInboxSmokeTestOk: boolean }> => ({
  serverlessInboxSmokeTestOk: flag === 'on',
});
