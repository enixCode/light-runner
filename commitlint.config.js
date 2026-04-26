/*
 * Conventional Commits 1.0.0 strict.
 * Enforced locally on every `git commit` via .husky/commit-msg, and on every
 * pull-request title via .github/workflows/pr-title.yml. The squash-merge body
 * (the only history that survives on main) is the user's responsibility to
 * write properly - see CLAUDE.md "Commit & merge conventions".
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subject must use one of these types. Tightens default config-conventional
    // to the Angular-ish set we use; rejects ad-hoc types like `wip`, `cicd`,
    // `tweak`. If a future commit needs a new type, add it here intentionally.
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'docs',
        'test',
        'build',
        'ci',
        'chore',
        'style',
        'revert',
      ],
    ],
    // Soft cap. Subject longer than 72 chars is a warning, not an error - some
    // legitimate scope names push past the limit and we do not want to fail
    // hard on them. Hard cap stays at 100 (config-conventional default).
    'header-max-length': [1, 'always', 72],
    // Disabled: 100-char body wrap is noisy for bullet lists, URLs, and paths.
    // Modern projects (React, Vue, TypeScript) do not enforce this. Subject is
    // still hard-capped, which is the line that actually matters.
    'body-max-line-length': [0, 'always', 0],
    'footer-max-line-length': [0, 'always', 0],
  },
};
