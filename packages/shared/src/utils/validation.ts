/**
 * 表单校验工具函数
 *
 * @description
 * 客户端输入校验，在发送 API 请求前拦截不合规数据。
 * 校验规则与后端保持一致。
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 密码强度校验
 *
 * 要求：
 * - 至少 8 个字符
 * - 至少包含 1 个大写字母 (A-Z)
 * - 至少包含 1 个小写字母 (a-z)
 * - 至少包含 1 个数字 (0-9)
 * - 至少包含 1 个特殊字符 (!@#$%^&*()_+-=[]{}|;':",./<>?`~)
 *
 * @returns 校验结果，包含是否通过和错误信息列表
 */
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("密码长度至少 8 位");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("密码需包含大写字母");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("密码需包含小写字母");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("密码需包含数字");
  }
  if (!/[!@#$%^&*()_+\-=[\]{}|;':",./<>?`~]/.test(password)) {
    errors.push("密码需包含特殊字符");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 元聊号格式校验
 *
 * 要求：至少 3 个字符，仅允许字母、数字、下划线
 */
export function validateYuanchatId(id: string): ValidationResult {
  const errors: string[] = [];

  if (id.trim().length < 3) {
    errors.push("元聊号长度至少 3 位");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(id)) {
    errors.push("元聊号只能包含字母、数字和下划线");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 手机号格式校验
 *
 * 要求：中国大陆手机号 11 位，以 1 开头
 */
export function validatePhone(phone: string): ValidationResult {
  const errors: string[] = [];

  if (!phone.trim()) {
    errors.push("请输入手机号");
  } else if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
    errors.push("手机号格式不正确");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 昵称格式校验
 *
 * 要求：至少 2 个字符，最多 20 个字符
 */
export function validateNickname(nickname: string): ValidationResult {
  const errors: string[] = [];

  if (!nickname.trim()) {
    errors.push("请输入昵称");
  } else if (nickname.trim().length < 2) {
    errors.push("昵称长度至少 2 位");
  } else if (nickname.trim().length > 20) {
    errors.push("昵称长度不能超过 20 位");
  }

  return { valid: errors.length === 0, errors };
}
