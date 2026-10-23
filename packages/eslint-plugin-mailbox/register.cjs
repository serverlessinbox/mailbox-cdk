const path = require('node:path');

require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, 'tsconfig.json'),
});
