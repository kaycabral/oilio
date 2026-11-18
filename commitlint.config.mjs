/**
 * Conventional Commits + regras canônicas do oilio.
 *
 * Documentado em `CONTRIBUTING.md` § Commits. Esta config materializa as
 * regras como enforcement automático via husky commit-msg hook.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scope obrigatório (CONTRIBUTING.md: "Conventional Commits com scope")
    'scope-empty': [2, 'never'],
    // Subject curto pra título de PR caber (CONTRIBUTING.md: "< 70 chars")
    'header-max-length': [2, 'always', 72],
    // Casing flexível no scope (alguns escopos têm '/' como saas/product)
    'scope-case': [2, 'always', ['lower-case', 'kebab-case']],
  },
}
