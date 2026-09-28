// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/next-env.d.ts', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  // React code: the interface's component package and app. (eslint-plugin-react
  // doesn't support ESLint 10 yet; the hooks rules are the ones that catch bugs.)
  { files: ['**/*.tsx'], ...reactHooks.configs.flat.recommended },
  // Next's own rules for the web app. (eslint-config-next brings
  // eslint-plugin-react, which doesn't support ESLint 10 yet.)
  {
    files: ['apps/ropa-web/**/*.{ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
    settings: { next: { rootDir: 'apps/ropa-web' } },
  },
  // The interface's `cn` knows the Rulemark foundations' names; the `cn`
  // package alone doesn't, and silently drops or keeps the wrong class.
  // `shadcn add` writes `from 'cn'`, so this catches every new component.
  {
    files: ['packages/ui/src/**/*.{ts,tsx}', 'apps/ropa-web/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/lib/utils.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'cn',
              message: "Import cn from '@rulemark/ui/lib/utils', which knows the Rulemark theme.",
            },
          ],
        },
      ],
    },
  },
  // Test servers on a random port bind 127.0.0.1 and wait until they're
  // listening: in the API, through listenOnLoopback() (test/listen.ts);
  // elsewhere, with a callback. A bare `listen(0)` binds every interface,
  // where macOS can hand out a port another process holds on 127.0.0.1 and
  // the test's requests reach that process; `listen(0, host)` without a
  // callback isn't listening yet on the next line.
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    ignores: ['apps/ropa-api/test/listen.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='listen'][arguments.0.value=0][arguments.length<3]",
          message:
            "Bind test servers to 127.0.0.1 and wait until they listen: the API's listenOnLoopback(), or listen(0, '127.0.0.1', callback).",
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
