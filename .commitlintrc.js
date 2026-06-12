module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',      // 新功能
        'fix',       // Bug 修复
        'docs',      // 文档
        'style',     // 格式（不影响代码运行）
        'refactor',  // 重构
        'perf',      // 性能优化
        'test',      // 测试
        'chore',     // 构建/工具/依赖
        'ci',        // CI/CD
        'revert',    // 回滚
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
};
