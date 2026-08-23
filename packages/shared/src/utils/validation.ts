/**
 * 表单校验工具函数
 *
 * @description
 * 客户端输入校验，在发送 API 请求前拦截不合规数据。
 * 校验规则与后端保持一致。
 *
 * {@link ValidationResult.errors} 里返回的是 i18n key 而不是成品文案：
 * 这些工具在 shared 层，拿不到 `t()`（也不该在纯函数里绑定语言），
 * 由调用方在渲染时 `t(errors[0])` 落地，登录/注册页才能跟随界面语言。
 */

export interface ValidationResult {
  valid: boolean;
  /** 未通过的原因，元素为 i18n key（如 `validation.passwordDigit`），由调用方翻译 */
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
 * @returns 校验结果，errors 为 i18n key 列表
 */
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("validation.passwordMinLength");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("validation.passwordUppercase");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("validation.passwordLowercase");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("validation.passwordDigit");
  }
  if (!/[!@#$%^&*()_+\-=[\]{}|;':",./<>?`~]/.test(password)) {
    errors.push("validation.passwordSpecial");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 元聊号格式校验
 *
 * 要求：至少 3 个字符，仅允许字母、数字、下划线
 *
 * @returns 校验结果，errors 为 i18n key 列表
 */
export function validateYuanchatId(id: string): ValidationResult {
  const errors: string[] = [];

  if (id.trim().length < 3) {
    errors.push("validation.idMinLength");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(id)) {
    errors.push("validation.idCharset");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 手机号格式校验
 *
 * 要求：中国大陆手机号 11 位，以 1 开头
 *
 * @returns 校验结果，errors 为 i18n key 列表
 */
export function validatePhone(phone: string): ValidationResult {
  const errors: string[] = [];

  if (!phone.trim()) {
    errors.push("validation.phoneRequired");
  } else if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
    errors.push("validation.phoneFormat");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 昵称格式校验
 *
 * 要求：至少 2 个字符，最多 20 个字符
 *
 * @returns 校验结果，errors 为 i18n key 列表
 */
export function validateNickname(nickname: string): ValidationResult {
  const errors: string[] = [];

  if (!nickname.trim()) {
    errors.push("validation.nicknameRequired");
  } else if (nickname.trim().length < 2) {
    errors.push("validation.nicknameMinLength");
  } else if (nickname.trim().length > 20) {
    errors.push("validation.nicknameMaxLength");
  }

  return { valid: errors.length === 0, errors };
}
