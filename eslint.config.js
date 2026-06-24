const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores([
    'dist/*',
    'dist-check/*',
    '.expo/*',
    'src/components/*',
    'src/components/**/*',
    'src/hooks/*',
    'src/constants/*',
  ]),
  expoConfig,
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
