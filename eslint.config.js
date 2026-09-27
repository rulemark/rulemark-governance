// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  // React code: the interface's component package and app. (eslint-plugin-react
  // doesn't support ESLint 10 yet; the hooks rules are the ones that catch bugs.)
  { files: ['**/*.tsx'], ...reactHooks.configs.flat.recommended },
  {
    rules: {
      // A leading underscore marks something deliberately unused: a required
      // middleware parameter, or a binding that exists only to omit a key from
      // an object. `ignoreRestSiblings` covers `const { a, ...rest } = obj`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
