/**
 * 元聊 YuanChat — i18n 国际化类型定义
 *
 * @description
 * 使用 TypeScript 强类型约束所有翻译 key，
 * 编译期保证翻译完整性，避免运行时的缺失翻译错误。
 *
 * 命名规范：<模块>.<子模块>.<字段>
 * 例如：chat.input.placeholder、auth.login.title
 */

export interface TranslationKeys {
  // ========== 通用 ==========
  "common.ok": string;
  "common.cancel": string;
  "common.confirm": string;
  "common.save": string;
  "common.delete": string;
  "common.edit": string;
  "common.search": string;
  "common.loading": string;
  "common.retry": string;
  "common.noData": string;
  "common.online": string;
  "common.offline": string;
  "common.busy": string;
  "common.more": string;

  // ========== 设置 ==========
  "settings.title": string;
  "settings.general": string;
  "settings.appearance": string;
  "settings.language": string;
  "settings.fontSize": string;
  "settings.fontSize.small": string;
  "settings.fontSize.normal": string;
  "settings.fontSize.large": string;
  "settings.fontSize.xlarge": string;
  "settings.skin": string;
  "settings.notifications": string;
  "settings.privacy": string;
  "settings.about": string;
  "settings.logout": string;

  // ========== 皮肤 ==========
  "skin.title": string;
  "skin.yuanLight": string;
  "skin.yuanDark": string;
  "skin.oceanLight": string;
  "skin.oceanDark": string;
  "skin.forestLight": string;
  "skin.forestDark": string;
  "skin.systemFollows": string;

  // ========== 认证 ==========
  "auth.login": string;
  "auth.register": string;
  "auth.account": string;
  "auth.password": string;
  "auth.phoneOrEmail": string;
  "auth.yuanchatId": string;
  "auth.verificationCode": string;
  "auth.sendCode": string;
  "auth.noAccount": string;
  "auth.hasAccount": string;
  "auth.forgotPassword": string;
  "auth.nickname": string;
  "auth.loginSuccess": string;
  "auth.loginFailed": string;
  "auth.registerSuccess": string;
  "auth.showPassword": string;
  "auth.hidePassword": string;

  // ========== 聊天 ==========
  "chat.title": string;
  "chat.selectConversation": string;
  "chat.searchConversation": string;
  "chat.newChat": string;
  "chat.input.placeholder": string;
  "chat.input.send": string;
  "chat.input.image": string;
  "chat.input.file": string;
  "chat.input.emoji": string;
  "chat.message.revoke": string;
  "chat.message.revokeConfirm": string;
  "chat.message.revoked": string;
  "chat.message.copy": string;
  "chat.message.reply": string;
  "chat.message.forward": string;
  "chat.message.image": string;
  "chat.message.file": string;
  "chat.message.voice": string;
  "chat.groupChat": string;
  "chat.privateChat": string;

  // ========== 通讯录 ==========
  "contacts.title": string;
  "contacts.search": string;
  "contacts.add": string;
  "contacts.newFriend": string;
  "contacts.group": string;
  "contacts.myGroups": string;
  "contacts.blocked": string;

  // ========== 通知 ==========
  "notification.newMessage": string;
  "notification.messageFrom": string;
  "notification.imageMessage": string;
  "notification.fileMessage": string;
  "notification.voiceMessage": string;

  // ========== 日期时间 ==========
  "time.justNow": string;
  "time.minutesAgo": string;
  "time.hoursAgo": string;
  "time.yesterday": string;
  "time.daysAgo": string;
  "time.weeksAgo": string;
  "time.monthsAgo": string;

  // ========== 文件 ==========
  "file.upload": string;
  "file.download": string;
  "file.preview": string;
  "file.sizeLimit": string;
  "file.unsupportedType": string;

  // ========== 错误 ==========
  "error.network": string;
  "error.server": string;
  "error.timeout": string;
  "error.unknown": string;
}
