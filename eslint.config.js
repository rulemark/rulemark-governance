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
  // Test servers on a random port start through listenOnLoopback()
  // (apps/ropa-api/test/listen.ts), which binds 127.0.0.1 and waits until it's
  // listening. A bare `listen(0)` binds every interface, where macOS can hand
  // out a port another process holds on 127.0.0.1 and the test's requests
  // reach that process; `listen(0, host)` without a callback isn't listening
  // yet on the next line. A callback, as in the service harnesses, is fine.
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    ignores: ['apps/ropa-api/test/listen.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='listen'][arguments.0.value=0][arguments.length<3]",
          message: 'Start test servers with listenOnLoopback() from apps/ropa-api/test/listen.ts.',
        },
      ],
    },
  },
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
