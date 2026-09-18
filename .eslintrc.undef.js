// A deliberately tiny lint config with one job: catch a name that is used but
// never defined.
//
// That is the bug that blanked Order Analysis — `buildVelocity` was called and
// never imported, which is a ReferenceError at render, which unmounts the
// entire React tree and shows a white page.
//
// It reached production because `react-scripts build` does not check for it.
// With no eslint config in package.json, CRA's lint step does not run at all,
// and the build exits 0 with the broken code in it. Verified both ways: broken
// code builds clean, and with linting switched on the same code fails with
// "'buildVelocity' is not defined  no-undef".
//
// The obvious fix — add a full eslint config to package.json — is worse than it
// looks. It switches linting on for the whole codebase, and because deploy.sh
// builds with CI=1, every pre-existing warning becomes a build error: unused
// variables, missing alt text, hook dependency arrays. Around forty of them.
// The deploy would break over cosmetics while fixing nothing that crashes.
//
// So this checks two rules and nothing else. A name that does not exist is
// never a style opinion — it is a page that will not open.
//
//     npm run lint:undef
//
// deploy.sh runs it before the build, so a missing import stops a deploy
// instead of blanking a screen.

module.exports = {
  root: true,
  parser: '@babel/eslint-parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // No babel config file and no preset. This only has to *parse* JSX well
    // enough to see which names are referenced — it never transforms anything,
    // so pulling in babel-preset-react-app would only add a dependency on
    // NODE_ENV being set, which it then refuses to run without.
    requireConfigFile: false,
    // The jsx plugin has to be named for Babel itself; `ecmaFeatures.jsx` only
    // tells ESLint, and @babel/eslint-parser hands the source to Babel first.
    babelOptions: { parserOpts: { plugins: ['jsx'] } },
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
    // es2021 rather than es6: `react-app` declares es6, which is ES2015, so
    // standard globals added since — globalThis among them — read as undefined.
    es2021: true,
    node: true,
  },
  plugins: ['react'],
  rules: {
    'no-undef': 'error',
    'react/jsx-no-undef': 'error',
  },
}
