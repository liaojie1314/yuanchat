# 验证码下发通道选型（短信 / 邮箱）

> 查询日期：**2026-10-06**。本文所有价格、额度、政策均附来源链接，**价格与资质政策会变**，
> 下单前务必回原页面复核。凡本次未能从官方页面查到的数字，一律标注「未能从官方文档确认」，
> 不做任何估算填充。

## 0. 为什么需要这份文档

后端已有验证码下发通道抽象 `server/internal/pkg/codesender`（接口 `Sender.Send(ctx, target, code) error`），
但目前只实现了 `LogSender`——把打码后的验证码写进日志，仅供开发。于是：

- **忘记密码在线上不可用**：`POST /api/v1/auth/password/otp` 会正常返回 204、Redis 里也存了码，
  但真实用户永远收不到（码只在服务端日志里）。
- **注册未验证手机号归属**：目前只有 SVG 算术图片验证码，下一步要加手机/邮箱验证码，
  同样依赖这个通道。

本项目的三条硬约束决定了选型，它们比价格重要得多：

| 约束                               | 后果                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 使用者是**个人开发者**，无企业主体 | 国内四家云厂商的短信签名**全部**需要企业资质，个人只能走「他用签名」（需借一家企事业单位的证件 + 双方盖章授权委托书） |
| 服务器在**海外**（非中国内地 IP）  | 阿里云明文要求国内短信「只能由中国内地 IP 发送」，直接否决                                                            |
| 自有域名**无 ICP 备案**            | 腾讯云已不支持「网站」类签名来源，备案对签名本身影响不大；但没有备案通常意味着也没有大陆企业主体，与第一条叠加        |

---

## 1. 结论性对比

单价一栏：国内厂商按「验证码类、最小可买档位」的单价计；国际厂商按官方美元价
标注，括号里的人民币仅按 **1 USD ≈ 7.1 CNY** 粗折（汇率非官方页面数据，自行复核）。

| 方案                           | 单价                                                                                     | 免费额度                                                                  | 个人主体能否用                                                          | 大陆号码可用性                                                                                        | 接入复杂度                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **邮箱验证码 + 自有邮箱 SMTP** | ¥0                                                                                       | 受服务商日发量限制（QQ 个人约数十封/日）                                  | ✅ 完全可以，**无需域名、无需审核**                                     | ✅ 不受运营商管辖                                                                                     | **最低**（Go 标准库 `net/smtp`，已实现并实测通过）                |
| **邮箱验证码 + Resend**        | ¥0（免费档内）                                                                           | 3,000 封/月、100 封/日                                                    | ✅ 完全可以                                                             | ✅ 不受运营商管辖                                                                                     | 低（SMTP/HTTP API，一天能通）                                     |
| **邮箱验证码 + Brevo**         | ¥0（免费档内）                                                                           | 300 封/日 ≈ 9,000 封/月                                                   | ✅ 完全可以                                                             | ✅ 同上                                                                                               | 低                                                                |
| 腾讯云短信                     | ¥0.047/条（1 万条档 ¥470）                                                               | 首开赠 100 条（个人认证），3 个月有效                                     | ⚠️ **签名拿不到**：个人主体无法运营商实名报备，只能借企业做他用签名     | ✅ 最佳                                                                                               | 中（签名+模板审核 2h，运营商报备 7–10 工作日）                    |
| 阿里云短信                     | ¥0.05/条（1000 条档 ¥50）；按量 ¥0.045/条                                                | 试用测试包 100 或 200 条                                                  | ⚠️ 同上，且**本项目直接否决**                                           | ❌ **国内短信只能由中国内地 IP 发送**，海外服务器用不了                                               | 中                                                                |
| 华为云短信                     | **未能从官方文档确认**                                                                   | 未能从官方文档确认                                                        | ❌ 资质申请前提就写明「已注册华为**企业**账号，并完成**企业**实名认证」 | ✅                                                                                                    | 中高（还要法人证件 + 经办人手持身份证）                           |
| 七牛云短信（转售）             | ¥0.043/条                                                                                | 300 条（100 验证码 + 100 通知 + 100 推广），**需完成企业认证**才享        | ❌ 免费额度明文要求企业认证                                             | ✅                                                                                                    | 中                                                                |
| Twilio                         | $0.1082/段（≈¥0.77）+ 国际号码 $1.15/月                                                  | 试用赠额**未能从官方页面确认**（见 §3.1 坑位）                            | ✅ 不要求中国主体                                                       | ⚠️ 仅 "Commercially Reasonable Efforts"，**不保证送达**，**正文禁 URL**，不支持 alphanumeric 发送方   | 低（HTTP API）                                                    |
| AWS End User Messaging / SNS   | **未能从官方文档确认**（官方只说"guidance only, change frequently"，不列中国单价）       | SNS 免费层**不含 SMS**                                                    | ✅ 不要求中国主体                                                       | ❌ 必须先经 **Support 工单报备模板**，否则消息被拦截；China 行 Sender ID=No、International sending=No | 高（走工单，初次响应 24h，还要回填国别表单）                      |
| Vonage / Bird 等其他国际商     | **未能从官方页面确认**（定价页与支持站对本机 IP 返回 403）                               | 未能从官方页面确认                                                        | ✅                                                                      | 未能从官方页面确认                                                                                    | —                                                                 |
| Firebase Phone Authentication  | 按条计费，**单价未能从官方页面确认**（Identity Platform 定价页为 JS 渲染，抓不到费率表） | **Spark 免费档标注 "Not applicable"——手机验证根本不可用**，必须升级 Blaze | ✅                                                                      | ❌ 强制 reCAPTCHA（Google 域名大陆不可达）+ 新项目 SMS region policy 默认 **allow no regions**        | 高且**架构换轨**（客户端 SDK 直接验证，绕开 `codesender.Sender`） |

---

## 2. 推荐顺序（不是「各有优劣你自己选」）

### 第一选择：把验证码改走邮箱 —— 已实现并实测通过

**就做这个，而且已经做完了。** 理由不是它最好，而是它是**唯一一个以当前身份
（个人 + 海外服务器 + 无备案）今天就能真正跑通的方案**。其余所有短信方案都卡在同一处：
国内短信签名必须挂企业主体。

本项目实现了两条邮件通道，**推荐 `smtp`**：

| provider           | 用什么                               | 要准备什么                      | 适用               |
| ------------------ | ------------------------------------ | ------------------------------- | ------------------ |
| **`smtp`**（推荐） | 你自己的 QQ / 163 / Gmail / 企业邮箱 | 只要一个**授权码**，30 秒       | 自建、小规模       |
| `resend`           | Resend 的 HTTP API                   | 一个**自有域名**并完成 DNS 验证 | 量大、要独立发件域 |

选 `smtp` 的理由：**不需要域名、不需要任何审核**，用的是 Go 标准库 `net/smtp`，
一份实现通吃所有服务商，没有第三方 SDK 依赖。代价是受服务商的日发量限制
（QQ 个人邮箱大约数十封/日），到了那个量级再换 `resend` 或企业邮。

2026-10-06 实测结论（本机与生产服务器双向验证过）：

- 生产服务器出站 **465 / 587 可达 `smtp.qq.com`，25 被云厂商封禁**（这是常态，别填 25）
- QQ **没有**因为「海外 IP 登录」拒绝 SMTP 认证 —— 这是上线前最该先验的一条
- 发往 163 / Gmail / QQ 三个收件箱全部正常到达

- 成本：¥0。
- 不需要：企业营业执照、ICP 备案、大陆 IP、运营商报备、等 7–10 个工作日，
  选 `smtp` 时连域名都不需要。
- 项目已支持邮箱注册，用户侧不是全新概念。

**代价要说清楚**（这是真代价，不是小字）：

1. **只用手机号注册的老用户没有邮箱可收码**。`POST /api/v1/auth/password/otp` 的入参
   已从 `{"phone": ...}` 改为 `{"account": ...}`，手机号与邮箱都接受（服务端按是否含 `@`
   路由到 `FindByEmail` / `FindByPhone`），但只绑了手机号的账号在 `smtp` 通道下仍然收不到码 ——
   这类用户需要先用已登录的设备在设置里补绑邮箱。
2. **注册验证从「验证手机号归属」改为「验证邮箱归属」**。手机号仍可填、仍可作为登录账号，
   但它不再被证明属于注册者。注意图形验证码**已连同端点一起删除**（它证明的是「对面是人」，
   不是「这个邮箱属于他」），防刷现在靠：邮箱维度 60 秒冷却 + IP 维度限流 + 错码 5 次锁 15 分钟。
3. 邮箱验证码的到达体验不如短信：可能进垃圾箱、企业邮箱可能延迟。需要在 UI 上写
   「没收到？检查垃圾邮件」。

### 第二选择：确实非要短信——借企业主体做「他用签名」，走腾讯云

只有当「必须是短信」是硬需求时才做。前提是**你能找到一家企事业单位**愿意出营业执照扫描件
并在授权委托书上盖章（且该主体要为你发出的短信内容担责——这不是形式，运营商违规是真罚款）。

选腾讯云而不是阿里云的原因有两条，都很硬：

1. 阿里云文档明文写「发送国内短信也只能由中国内地 IP 发送」。本项目服务器在海外，
   这一条直接判死（除非再架一台大陆中转机，那又要备案）。腾讯云《使用须知》与
   《购买指南》里**没有**同类表述（注：「没有写」不等于「明确允许」，下单前建议开工单问一句）。
2. 腾讯云个人认证用户可发验证码与通知类，赠送 100 条足够联调。

价格参考：1 万条档 ¥470（¥0.047/条），自定义包起购 1,000 条、¥0.050/条。

### 第三选择：Twilio 发 +86，仅作应急 / 极低量

- 单价 $0.1082/段 ≈ ¥0.77，**约为腾讯云的 16 倍**，外加国际号码 $1.15/月租。
- 好处：不需要中国企业主体、不需要签名报备、HTTP API 一小时能接完。
- 坏处（官方原文）：到中国只做 "Commercially Reasonable Efforts to deliver…
  however, delivery is not guaranteed"；**正文不允许出现 URL**；alphanumeric 发送方
  三种形态 Twilio 一律不支持，用户看到的发送方会被运营商改写。

验证码短信不含 URL，内容限制勉强能忍；但「不保证送达」意味着它不能当唯一通道。
如果真要用，应当与邮箱通道并行（短信失败回落邮箱），而不是替代。

### 明确不推荐

- **阿里云**：大陆 IP 限制对海外部署是一票否决。
- **华为云 / 七牛云**：前置条件就是企业认证，个人连资质都提交不了。
- **AWS End User Messaging / SNS**：中国是全球唯一需要「模板报备」的目的地，而且走人工工单；
  China 一行 `Supports Sender IDs = No`、`International sending = No`。
  对个人项目来说流程成本远超收益。
- **Firebase Phone Authentication**：三重否决——免费档不提供该功能、强制 reCAPTCHA
  依赖 Google 域名（大陆用户加载不出来直接卡死在发码前）、而且它是客户端 SDK 方案，
  与服务端 `codesender.Sender` 抽象不是一回事（详见 §3.3）。

---

## 3. 逐方案详情与坑

### 3.1 国内云厂商短信

#### 腾讯云短信

**价格**（来源：[购买指南](https://cloud.tencent.com/document/product/382/8414)，2026-10-06 查）

国内短信**没有独立的按量付费单价**，只以套餐包预付费销售，自购买日起 **2 年**有效：

| 固定套餐包 | 售价     | 单价      |
| ---------- | -------- | --------- |
| 1 万条     | ¥470     | ¥0.047/条 |
| 10 万条    | ¥4,500   | ¥0.045/条 |
| 50 万条    | ¥22,500  | ¥0.045/条 |
| 100 万条   | ¥43,000  | ¥0.043/条 |
| 300 万条   | ¥123,000 | ¥0.041/条 |

自定义套餐包起购 1,000 条，阶梯：0.1–1 万条 ¥0.050/条，1–10 万条 ¥0.047/条，
10–100 万条 ¥0.045/条，100–300 万条 ¥0.043/条，≥300 万条 ¥0.041/条。
原页注明部分价格自 2026-04-01 起做过调整。

**免费额度**：首次开通短信服务按认证主体赠送——个人认证 **100 条**，企业认证 200 条
（企业档位自 2026-03-24 起由原值改为 200 条）。需「0 元下单方式领取」，约 5 分钟生效，
**自发放日起 3 个月内有效，不支持退款**，同一主体下多账号仅首个开通账号可享。

> ⚠️ 数字不一致：《使用须知》（[382/13444](https://cloud.tencent.com/document/product/382/13444)）
> 同日写的是「个人 100 条 / 企业 500 条」，与《购买指南》的 200 条冲突。
> 两处都是官方文档，以控制台下单页实际显示为准。

**个人身份到底能不能开通**：能开通、能买包、能发验证码与通知类（营销类仅企业），
**但签名拿不到**——这是真正的拦路虎：

> 「签名归属主体为个人时无法进行 国内短信运营商签名实名报备」
> 「个人认证用户请提前准备 **企业证件** 和 **授权委托书** 用于 申请他用资质 和 申请短信签名，
> 或将账号 升级为企业认证」
> —— [创建签名](https://cloud.tencent.com/document/product/382/37794)

签名用途「他用」时，授权委托书要求「被授权方需为当前腾讯云账号实名认证的个人/企业名称全称，
授权方需为签名所属主体公司名全称」，且「在授权委托书上加盖**双方公章**」。
个人作为被授权方是允许的——这是个人主体唯一的合法通道。

**材料与审核周期**

| 环节           | 时长（官方）                                                            |
| -------------- | ----------------------------------------------------------------------- |
| 平台审核签名   | 「预计 2 小时完成审核」，工作时间周一至五 9:00–21:00、周六日 9:00–18:00 |
| 运营商实名报备 | 「报备流程据观测一般需要 **7–10 个工作日**」，运营商未承诺时效          |
| 正文模板审核   | 约 2 小时                                                               |

**坑**

- 签名来源已收窄：腾讯云「不再支持网站、公众号、小程序」，企业主体仅支持
  公司 / 商标 / 政府机关事业单位 / 其他机构。所以「我有个网站」这条老路已经没了。
- 「签名内容完全连续包含在营业执照全称中」，否则驳回重申。借来的公司名怎么起签名要先想好。
- **签名会闲置失效**：「已超 3 个月未使用，在运营商侧实名信息不全或已失效。
  如需使用，请删除后重新申请。」个人小项目量少，极易踩中——好不容易报备下来的签名
  三个月没发就作废，还得重走 7–10 个工作日。
- **签名与模板的 API 个人认证不支持**，只能在控制台手工点。自动化别想了。
- 「国内短信仅支持中国大陆公司授权申请签名」，港澳台及境外主体不行。
- 验证码模板的变量「每个变量取值最多支持 6 位纯数字」——正好够 6 位码，但别想塞别的。

#### 阿里云短信

**价格**（来源：[中国内地短信计费](https://help.aliyun.com/zh/sms/product-overview/billing-of-messages-sent-to-chinese-mainland)，2026-10-06 查）

按量付费（当月累计量实时梯度，跨档后当月全部重算）：

| 当月用量     | 验证码 + 通知 | 推广      |
| ------------ | ------------- | --------- |
| ≤10 万条     | ¥0.045/条     | ¥0.055/条 |
| 10–30 万条   | ¥0.042        | ¥0.052    |
| 30–50 万条   | ¥0.041        | ¥0.051    |
| 50–100 万条  | ¥0.040        | ¥0.050    |
| 100–300 万条 | ¥0.039        | ¥0.049    |
| >300 万条    | ¥0.038        | ¥0.048    |

套餐包（三类同价）：1000 条 ¥50、2000 条 ¥100、5000 条 ¥250、1.5 万条 ¥705、
5 万条 ¥2,250、20 万条 ¥8,800、50 万条 ¥21,500、100 万条 ¥42,000、300 万条 ¥123,000。

**免费额度**：阿里云免费试用页可领「100 条或 200 条」测试包
（来源：[计费概述](https://help.aliyun.com/zh/sms/product-overview/billing-overview)）。

**致命坑（对本项目直接否决）**

> 「国内短信套餐包仅可用于国内文本短信服务，不可用于国际/港澳台短信服务，
> 发送国内短信也**只能由中国内地 IP 发送**」
> —— 同上，「适用范围」节

本项目后端跑在海外服务器上，调 API 的出口 IP 是一个海外地址。
这句话写在套餐包的适用范围里，口径上是否覆盖纯按量付费存在解释空间，
但在海外服务器上押注「文档只约束套餐包」不是工程决策，是赌博。

**其它坑**

- 「个人认证用户申请签名时，若关联资质类型选择**自用**，所申请签名**无法通过运营商签名实名报备**」
  ——解决办法只有改用他用资质或升级企业认证
  （来源：[创建签名](https://help.aliyun.com/zh/sms/user-guide/create-signatures)）。
- 签名来源「**已上线 APP**」运营商已不再支持。靠「我有个 App」申请签名这条路也断了。
- 他用授权书的「授权方统一社会信用代码需与选中资质信息的统一社会信用代码字段一致，
  不一致无法提交」；有效期建议 1–3 年。
- 个人认证用户只能申请验证码和通知模板，不能申请推广模板。
- 审核：签名「预计 2 个小时内审核完成」（周一至周日 9:00–21:00）；
  运营商实名报备「平均需要 5–7 个工作日」，部分情况 7–10 个工作日。
- 计费按运营商回执：提交成功但回执失败不计费；国内短信 70 字内算 1 条，
  超出按 67 字/条拆分计费。

#### 华为云短信

- **价格未能从官方文档确认**。[产品页](https://www.huaweicloud.com/product/msgsms.html)
  只给「价格计算器」「购买套餐包」入口（均为 JS 渲染页），帮助中心也无静态定价页。
- **个人基本无门**：《申请国内短信资质》前提条件写明「已注册华为**企业**账号，
  并完成**企业**实名认证」，且「目前仅发往国内的短信支持资质管理功能」
  （来源：[sms_03_1008](https://support.huaweicloud.com/usermanual-msgsms/sms_03_1008.html)）。
- 材料比腾讯/阿里更重：企业证件 + 统一社会信用代码 + 法人姓名证件号 +
  **管理员身份证人像面、国徽面及手持身份证照片**，且「管理员必须为短信签名所属公司的经办人」。
  借主体做这件事，对方要交的东西太多，现实中几乎谈不下来。
- 审核：签名「验证码、通知、推广类短信签名提交申请后，预计 **7–10 个工作日**内完成审核」；
  模板约 2 小时；签名通过后通道号配置还要等 15–30 分钟。
- 另有「华为云账户余额不足时，无法添加签名/模板」。

#### 七牛云（第三方转售商）

- 单价 **¥0.043/条**，验证码 / 通知 / 推广统一价，仅支持预付费资源包
  （来源：[七牛云短信价格](https://www.qiniu.com/prices/sms)）。
- 免费额度：**300 条**（验证码 100 + 通知 100 + 推广 100），有效期 1 年，
  但页面明文写需「完成**企业认证**后」才享。
- 页面未说明个人账号能否开通，也完全没提签名/模板报备流程——
  但转售商最终也要把签名送到同样的运营商报备系统，个人主体的限制不会因为换了一层转售而消失。
  **「中间商能帮你绕过签名报备」是这类方案最常见的误解**，不要据此下单。

### 3.2 国际服务商发中国大陆号码

这一类的共同特征：**不要求中国企业主体**（这是它们唯一的优势），
但对 +86 普遍有额外限制，且单价贵一个数量级。

#### Twilio

**价格**（来源：[Twilio SMS Pricing – China](https://www.twilio.com/en-us/sms/pricing/cn)，2026-10-06 查）

| 项目                              | 价格                                          |
| --------------------------------- | --------------------------------------------- |
| 出境 SMS（International Numbers） | **$0.1082 / 段** ≈ ¥0.77                      |
| 失败消息处理费                    | $0.001 / 条（仅 Failed 状态）                 |
| 国际号码月租                      | International Prefix starting at **$1.15/mo** |

原页注明 "Prices may change from time to time without notice and additional carrier fees may apply"。

**对中国大陆的限制**（来源：[Twilio SMS Guidelines – China](https://www.twilio.com/en-us/guidelines/cn/sms)）

- 送达：「Twilio shall use Commercially Reasonable Efforts to deliver SMS to China;
  however, **delivery is not guaranteed**.」
- **正文禁 URL**：「China messaging restrictions do not allow URLs in the content」。
  验证码短信本来不该带链接，但如果以后想发「点此重置密码」就不行。
- 发送方：alphanumeric sender ID 三种形态（国际预注册 / 国内预注册 / 动态）
  Twilio 一律 "Not Supported"；国内长号码、短号码也不支持。
  国内预注册类的 sender ID 状态是 "Overwritten"——
  「mobile subscribers will see a different 'from sender ID' than the one sent by you」。
  用户收到的短信看不出是谁发的。
- 禁止内容面很宽：政治、违法、色情、欺诈、**金融相关**（含银行/保险营销、贷款、信用卡、
  证券、股票、原油期货黄金加密货币）。违规后果：「The networks impose heavy fines
  and cut off connections if these rules are breached.」
- 不能发往固话（错误码 21614）；双向短信 No；MMS Not Available。
- 建议长度：UCS2 编码下最多 500 字符 / 8 段。

**坑**：试用账户的限制（赠送额度金额、是否只能发给已验证号码、消息是否被加上试用前缀）
**未能从官方页面确认**——本次抓取 `help.twilio.com` 与 `www.twilio.com/docs/...`
均返回 SSL 握手失败或仅有标题的 JS 骨架。业界普遍反馈试用账户只能发给
已在控制台验证过的号码、且正文会被加前缀，若确实如此则**试用额度无法用于真实用户联调**。
请在注册后用控制台实测确认，不要把试用额度算进上线预算。

#### AWS End User Messaging SMS（SNS 的现行承载）

**价格**：[SNS SMS pricing 页](https://aws.amazon.com/sns/sms-pricing/)
**不列中国单价**，原文 "The prices below are provided for guidance only,
and change frequently"，实际单价要发完之后从 daily usage reports 里看。
页面上与中国相关的唯一数字是短码（Short Code）费用：一次性开通费 $15、月费 $15、
预计开通时间 3 周。**每条短信单价未能从官方文档确认。**

**免费额度**：SNS 免费层**不含 SMS**（只含 100 万次移动推送、1,000 封邮件等）。

**对中国大陆的限制（最严的一家）**

[支持国家表](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html)
China (CN, 86) 一行：`Supports short codes = Yes`、`Supports long codes = No`、
`Supports Sender IDs = No`[注2]、`Supports two-way SMS = Yes`、
**`International sending = No`**。

注 2 原文：

> 「Senders are required to use a pre-registered template for each type of message
> that they plan to send. **If a sender doesn't meet this requirement, their messages
> will be blocked.**」
> 「To send messages to China, you must first register your templates through Support for approval.」

而且中国是**全球唯一**需要模板报备的目的地：
「**Only China** requires SMS template registration for your account to be allowed sending there.」
（来源：[China SMS template registration form](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-template-registration.html)）

报备要走人工工单，要提交：短信模板、每个收件人每月预计条数、opt-in 流程说明、
**公司或组织名称、公司地址、公司所在国家、公司电话、公司网站 URL**。
初次响应 24 小时内，之后还会下发一份国别专用表单让你回填。
原文还留了后门：「We might not be able to grant your request if your use case
doesn't align with our policies.」

**结论**：虽然不要求中国主体，但要求「公司」这一整套信息，个人项目基本填不出来，
且报备不通过就是全量拦截。流程成本远高于腾讯云的他用签名。

#### Vonage / MessageBird(Bird) / Infobip 等

**未能从官方页面确认任何数据。** 本次尝试的 URL：

- `https://www.vonage.com/communications-apis/sms/pricing/` → HTTP 403
- `https://api.support.vonage.com/hc/...`（Country-Specific Features and Restrictions）→ HTTP 403
- `https://developer.vonage.com/en/messaging/sms/guides/country-specific-features` → 200，
  但只是概览页，**不含 China 条目**，正文把国别规则全部指向上面那个 403 的支持站。

考虑到这一类（Vonage / Bird / Infobip）与 Twilio 属同一商业模式，
对 +86 的政策大概率与 Twilio 类似（不保证送达 + sender ID 被改写 + 内容受限），
但**这是推测，不是查到的事实**，不要写进任何成本测算。
真要评估就自己注册账号看控制台里的 per-destination 费率。

### 3.3 Firebase Phone Authentication

**这不是一个 `Sender` 实现，是换一套架构。** 它由客户端 SDK 直接向 Google 发起验证
（`signInWithPhoneNumber` → reCAPTCHA → 短信 → `confirmationResult.confirm(code)`），
验证通过后拿到的是 Firebase 的 ID token，不是本项目的 JWT。接进来意味着：

- 服务端要新增一条「校验 Firebase ID token → 换发本项目双 Token」的路径，
  `codesender.Sender` 在这条路上完全用不上；
- 手机号的真实性由 Google 背书，本项目的 Redis 发码/冷却/失败计数那套逻辑全部作废；
- 三端（Web / Tauri Desktop / Tauri Android）各要接一次 SDK，
  Tauri WebView 里的 reCAPTCHA 行为还需另行验证。

**免费额度与计费**

- [Firebase 定价页](https://firebase.google.com/pricing)：Phone Auth 在 Spark（免费）档
  标注 **"Not applicable"**——免费档根本不提供此功能；Blaze 档 "Billed per SMS sent"。
  **每条单价未能从官方页面确认**（指向的 Identity Platform 定价页为 JS 渲染，抓取只得到标题）。
- [Firebase Auth limits](https://firebase.google.com/docs/auth/limits)（页面标注最后更新 2026-10-01）：
  验证码短信「仅付费 Blaze 方案」，`Firebase Authentication: 3000 sent SMS/day limit`；
  升级 Identity Platform 后 "No limit"。总量限制 900 sent/minute、3,000 sent/day；
  单 IP 50 sent/minute、500 sent/hour；验证请求 150 requests/IP/hour。
- 另有 50K MAUs 免费（这是 Identity Platform 的月活额度，**不是**免费短信条数，别混淆）。

**中国大陆可用性的三个硬伤**（来源：[Phone auth (Web)](https://firebase.google.com/docs/auth/web/phone-auth)）

1. **强制 reCAPTCHA**：「Before you can sign in users with their phone numbers,
   you must set up Firebase's reCAPTCHA verifier.」`signInWithPhoneNumber` 会先发起
   reCAPTCHA 挑战，通过后才请求发短信。reCAPTCHA 依赖 Google 域名，
   大陆网络下加载不出来 → 用户卡在发码之前，连「收不到短信」都轮不到。
2. **新项目默认一个地区都不允许**：「Setting an SMS region policy can help protect
   your apps from SMS abuse. **For new projects, the default policy allows no regions.**」
   不显式把 CN 加进白名单，一条都发不出去。
3. **localhost 不能作为授权域名**：「Note that localhost is not allowed as a hosted
   domain for the purposes of phone auth.」——本地开发必须靠控制台里的测试号码
   （最多 10 个，不消耗配额、不真实发短信）。Tauri WebView 的 origin
   （`tauri://localhost` / `http://tauri.localhost`）能否通过授权域名校验，需实测。

Android 端还涉及 Google Play 服务可达性。文档提到测试号码的好处之一是便于
「在模拟器或**无 Google Play 服务**环境中开发」——反过来说明正式流程是依赖它的。
国内安卓机大量没有 GMS，这条路在目标用户群上不成立。

### 3.4 邮箱兜底（推荐首选）

项目已支持邮箱注册，`codesender.Sender` 的接口注释也写明 target 是「手机号**或邮箱**」，
抽象层面本来就留了口子。

| 服务商                    | 免费额度                                                                                          | 第一档付费                                 | 来源                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Resend**                | 3,000 封/月，**100 封/日**；3 个域名；30 天数据留存                                               | Pro $20/月含 5 万封，超量 $0.90 / 1,000 封 | [resend.com/pricing](https://resend.com/pricing)                                                                                       |
| **Brevo**                 | **300 封/日**（≈9,000 封/月），forever free，无需信用卡                                           | 从 $9/月起（事务邮件档）                   | [Brevo transactional email](https://www.brevo.com/products/transactional-email/)、[free SMTP](https://www.brevo.com/free-smtp-server/) |
| SendGrid                  | **未能从官方页面确认**（`sendgrid.com/en-us/pricing` 301 跳 `twilio.com`，后者本次抓取 SSL 失败） | 未能从官方页面确认                         | —                                                                                                                                      |
| 自建 SMTP（服务器自己发） | ¥0                                                                                                | ¥0                                         | —                                                                                                                                      |

**选 Resend 还是 Brevo**：Brevo 两个维度都更大（日 300 / 月 ≈9,000，对 Resend 的日 100 / 月 3,000），
但邮件带「Sent with Brevo」页脚；Resend 额度小一些，没有品牌水印，API 与文档更干净。
日发 100 封对「找回密码」场景够用；如果注册验证码也改走邮箱，日峰值可能顶到 100，
那就选 Brevo，或 Resend 升 Pro（$20/月、5 万封）。
**先上 Resend 免费档，额度不够再换**——两者都是标准 SMTP + HTTP API，换起来是改 env，不是改架构。

**坑**

- **Resend 必须先验证自有域名才能发信**：「Resend sends emails using a domain you own
  (i.e., not a shared or public domain).」「You must add and verify at least one domain
  to send emails with Resend.」（来源：[Domains 文档](https://resend.com/docs/dashboard/domains/introduction)）
  本项目已有自有域名，加 DNS 记录即可，不是障碍，但**别以为注册完就能发**。
  官方建议用子域发信隔离声誉（如 `mail.your-domain.com`）。
- Resend 免费档「只能发给自己注册邮箱」这一限制**未能从官方页面确认**
  （Domains 文档没提，Pricing 页只写了 100/日、3,000/月）。注册后实测一次再决定。
- **Brevo 免费档邮件带「Sent with Brevo」页脚**，去掉需要付费档（定价页的
  "No Brevo logo" 是 Starter 及以上的特性）。验证码邮件带第三方品牌脚注，观感差，
  但不影响功能。
- **自建 SMTP 是个陷阱**：海外 VPS 的 IP 几乎都在各大邮箱的低信誉段，
  发给 QQ 邮箱 / 163 / 腾讯企业邮大概率进垃圾箱或被直接拒收，而且 25 端口
  很多云厂商默认封禁。省下的几美元会变成「用户说收不到验证码」的无底洞工单。
  **要么用托管服务，要么别做邮箱通道。**
- 邮箱验证码必须和短信一样做防刷：同一邮箱冷却、同一 IP 限流。现有 Redis 那套
  （`otpKey` / `otpCooldownKey` / `otpFailKey`）直接复用即可，不需要新机制。

---

## 4. 首选方案的获取步骤

### 4.0 QQ / 163 邮箱授权码（当前实际在用，最快）

要的是**授权码**，不是邮箱登录密码。填错的表现极具误导性：注册页一直转圈，
前端完全看不出是发信认证失败，服务端只拿到一句 `535 Login Fail`。
（代码里已把这句提示塞进错误信息：`smtp 认证失败（QQ/163 需使用授权码而非登录密码）`）

**QQ 邮箱**

1. 浏览器打开 mail.qq.com 登录 → 右上 **设置** → **账号**
2. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」
3. 开启 **IMAP/SMTP 服务**（或 POP3/SMTP），按提示发一条短信验证
4. 验证通过后页面直接给出一串 16 位小写字母 —— 这就是授权码，**只显示一次**，当场存好
5. 服务器参数：`smtp.qq.com` / 端口 `465` / 登录名就是你的 QQ 邮箱地址

**163 邮箱**

1. mail.163.com 登录 → **设置** → **POP3/SMTP/IMAP**
2. 开启 **SMTP 服务** → 新增「客户端授权密码」，扫码或短信验证后得到授权密码
3. 服务器参数：`smtp.163.com` / 端口 `465` / 登录名就是你的 163 邮箱地址

**Gmail** 需要先开两步验证，再到「应用专用密码」生成 16 位密码；
服务器 `smtp.gmail.com` / 端口 `587`（STARTTLS）或 `465`（隐式 TLS）。

> 拿到后**先验连通性再上线**，顺序别颠倒 —— 上线后才发现发不出去，
> 用户那边是「注册页一直转圈」，没有任何错误提示：
>
> ```bash
> # 1. 服务器出站端口是否可达（云厂商基本都封 25，这步失败就别往下走了）
> timeout 8 bash -c 'exec 3<>/dev/tcp/smtp.qq.com/465' && echo 465 可达
>
> # 2. 用真实凭据实发一封（仓库里有现成的测试，不带凭据会自动跳过，不会污染 CI）
> cd server && SMTP_HOST=smtp.qq.com SMTP_PORT=465 \
>   SMTP_USER=你的邮箱 SMTP_PASSWORD=授权码 SMTP_TO=收件邮箱 \
>   go test ./internal/pkg/codesender/ -run TestSMTPLiveSend -v
> ```
>
> 第 1 步在**生产服务器上**跑，不是在本机 —— 本机通不代表服务器通，
> 而且部分邮件服务商会拒绝来自陌生海外 IP 的 SMTP 登录。

### 4.1 Resend（邮箱验证码，需自有域名）

页面路径按 2026-10-06 的控制台布局描述，改版后以实际为准。

1. **注册**：打开 <https://resend.com/signup>，用 GitHub 或邮箱注册。免费档不需要信用卡。
   注册完直接进 Dashboard，左侧导航依次是 Emails / Broadcasts / Domains / API Keys / Webhooks / Logs。
2. **添加并验证域名**（必做，不做发不出去）
   - 左侧 **Domains** → 右上 **Add Domain**。
   - Domain 填子域，建议 `mail.your-domain.com`（官方文档建议用子域隔离发信声誉，
     主域留给网站）。Region 选离服务器近的（服务器在海外，选 us-east-1 或 eu-west-1 都可）。
   - 提交后页面会列出要加的 DNS 记录（一条 MX + 若干 TXT，含 DKIM 与 SPF；
     具体记录值由 Resend 生成，这里不抄，照页面复制）。
   - 到你域名的 DNS 服务商处逐条添加。**注意**：如果 DNS 走 Cloudflare，
     这些记录要设为 **DNS only**（灰云），开橙云代理会让验证失败。
   - 回 Resend 页面点 **Verify DNS Records**，状态从 `Pending` 变 `Verified` 即可。
     通常几分钟，TTL 长的话等到 TTL 过期。
3. **拿 API Key**：左侧 **API Keys** → **Create API Key**。
   - Name 随便填（如 `yuanchat-prod`）。
   - Permission 选 **Sending access**（不要给 Full access——这个 key 只需要发信）。
   - Domain 限定为上一步验证的那个域名。
   - 创建后弹窗里的 `re_xxxxxxxx` **只显示一次**，立刻复制。
4. **填进本项目**：在 `deploy/.env` 里加（变量名见 §5，`deploy/.env.prod.example`
   也要同步补注释，由实施该功能的 PR 负责）：

   ```ini
   # ---------- 验证码下发通道 ----------
   # resend = 邮箱验证码（个人主体唯一可行方案）；log = 仅写日志（开发）
   CODESENDER_PROVIDER=resend
   CODESENDER_RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
   # 发件地址，必须在已验证域名下
   CODESENDER_FROM=YuanChat <noreply@mail.your-domain.com>
   ```

5. **验证真的发出去了**：部署后在真实后端上走一次忘记密码，
   然后在 Resend 控制台 **Logs** 页看这封邮件的投递状态（Delivered / Bounced / Complained）。
   `LogSender` 时代「接口返回 204 就算成功」的习惯要改掉——
   204 只代表码存进了 Redis，不代表用户收到了。

### 4.2 腾讯云（短信，仅在能借到企业主体时）

前提：已拿到一家企事业单位的**营业执照扫描件**（正本或副本，复印件需加盖公章）
和一份**双方盖章的授权委托书**（腾讯云控制台提供模板，授权方=该公司全称，
被授权方=你的腾讯云账号实名认证姓名全称）。

1. **注册并完成个人实名认证**：<https://cloud.tencent.com/> 注册，
   控制台右上「账号信息 → 实名认证」完成个人认证（身份证 + 人脸）。
2. **开通短信服务**：控制台搜索「短信」进入 SMS 控制台，首次进入点开通。
   同时领取「首次开通有奖」赠送的 100 条（0 元下单，约 5 分钟生效，**3 个月有效期**）。
3. **创建短信实名资质（他用）**：SMS 控制台左侧「国内短信 → 实名资质管理」→ 新建。
   - 资质用途选 **他用**（「签名为非本账号实名认证的公司、商标等」）。
   - 上传企业证件扫描件、填统一社会信用代码。
   - 上传授权委托书（jpg/png，单张 ≤5MB，公章须为红色可辨）。
   - 等审核通过——「审核通过和审核中的资质不支持删除」，一次填对。
4. **创建签名**：左侧「国内短信 → 签名管理」→ 创建签名。
   - 签名类型：企业主体可选公司 / 商标 / 政府机关事业单位 / 其他机构。
     选 **公司**（官方推荐，报备成功率高）。
   - 签名内容必须「完全连续包含在营业执照全称中」。
   - 关联上一步的他用资质。
   - 提交后约 2 小时出平台审核结果，之后进运营商实名报备，**7–10 个工作日**。
     报备完成前签名不可用。
5. **创建正文模板**：左侧「国内短信 → 正文模板管理」→ 创建。
   - 类型选**验证码**。
   - 正文形如 `您的验证码是{1}，{2}分钟内有效，请勿泄露。`
     验证码类模板「每个变量取值最多支持 6 位纯数字」——`{1}` 放 6 位码正好，
     `{2}` 放有效期分钟数（也是纯数字，没问题）。
   - 约 2 小时审核。记下 **模板 ID**（纯数字）。
6. **拿 SDK AppID 与密钥**
   - SMS 控制台左侧「应用管理 → 应用列表」，记下 **SDK AppID**（1400xxxxxx）。
   - 访问管理（CAM）→ 访问密钥 → API 密钥管理 → 新建密钥，得到 **SecretId** 与 **SecretKey**。
     SecretKey 只显示一次。**建议新建一个子用户只授予 `QcloudSMSFullAccess`，
     不要用主账号密钥**——主账号密钥泄露等于整个云账号失守。
7. **填进本项目**（变量名见 §5）：

   ```ini
   CODESENDER_PROVIDER=tencent
   CODESENDER_TENCENT_SECRET_ID=AKIDxxxxxxxx
   CODESENDER_TENCENT_SECRET_KEY=xxxxxxxx
   CODESENDER_TENCENT_SDK_APP_ID=1400xxxxxx
   CODESENDER_TENCENT_SIGN_NAME=借来的公司签名
   CODESENDER_TENCENT_TEMPLATE_ID=2xxxxxx
   CODESENDER_TENCENT_REGION=ap-guangzhou
   ```

8. **上线后要盯的事**：签名「已超 3 个月未使用」会在运营商侧失效，
   需删除后重新申请（又是 7–10 个工作日）。小流量项目极易踩中，
   建议加一条低频巡检或至少在日历上设提醒。

---

## 5. 在本项目里怎么配（已实现，照着填即可）

> 调研时这一节写的是「将来要改哪些地方」。现在通道已经实现并实测通过，
> 本节改成「怎么配」。实现落在 `server/internal/pkg/codesender/`：
> `codesender.go`（接口 + `New()` 工厂 + 打码）、`smtp.go`、`resend.go`。

### 5.1 填 `deploy/.env`

```ini
CODESENDER_PROVIDER=smtp
CODESENDER_HOST=smtp.qq.com
CODESENDER_PORT=465          # 465 隐式 TLS / 587 STARTTLS，**不要填 25**
CODESENDER_USERNAME=         # 留空则取 FROM（QQ / 163 的登录名就是邮箱地址）
CODESENDER_PASSWORD=         # 授权码，不是邮箱登录密码
CODESENDER_FROM=你的邮箱@qq.com
CODESENDER_SUBJECT=          # 留空取默认「验证码」
```

`deploy/.env.prod.example` 里有完整注释版。改完**必须重建 server 容器**让新环境变量生效：

```bash
./deploy/yuanchat.sh restart       # 或 docker compose -f deploy/docker-compose.prod.yml up -d
```

### 5.2 两个会让你白排查半天的点

1. **`provider` 填未知值时进程启动即失败**，这是故意的 —— 静默退回 `log` 等于验证码
   永远发不出去，而且不会有人发现。所以**升级顺序不能颠倒**：必须先部署支持该 provider
   的新镜像，再改 `.env` 开启。拿旧镜像配 `smtp`，结果是后端直接起不来。
2. **选了真实通道却缺凭据，同样启动即失败**（缺 `host` / `from` / `password` 任一项）。
   带着空凭据启动的话，要等第一个用户来发码才暴露，而那时他已经被 60 秒冷却锁住了 ——
   「收不到码且不能重发」比「服务起不来」难查得多。

### 5.3 已经改完的业务链路

- **注册改邮箱验证码**：`POST /api/v1/auth/register/otp`（body `{"email"}`）发码，
  `POST /api/v1/auth/register` 的 `captcha_id` / `captcha_answer` 换成 `code`。
  **图形验证码连 `GET /api/v1/captcha` 端点一起删除了。**
  注册发码对「邮箱是否已注册」一律照发、响应完全一致 —— 反过来按存在性区别对待，
  接口就变成账号枚举器（收到码说明未注册，没收到说明已注册）。真正的拦截在注册时回 409。
- **找回密码支持邮箱**：`/auth/password/otp` 与 `/auth/password/verify` 的入参
  从 `phone` 改为 `account`，手机号与邮箱都接受（服务端按是否含 `@` 路由）。
  为兼容已发布的旧客户端，服务端仍然接受 `phone` 字段。
- **验证码不进日志**：`maskCode` / `maskTarget` 打码，`codesender_test.go` 有针对明文的断言。
- **下发失败回滚**：`Send` 返回错误时把 Redis 里的验证码与冷却键一并删除。
- **防刷**：邮箱维度 60 秒冷却 + IP 维度限流（发码 3/5）+ 错码 5 次锁 15 分钟。
- 文案四语（`zh-CN` / `en-US` / `ja-JP` / `ko-KR`）同步，MSW mock 覆盖四态。

### 5.4 环境变量命名规则

`YUANCHAT_` 前缀 + 下划线替换点号，由 viper 的 `SetEnvPrefix("YUANCHAT")` +
`SetEnvKeyReplacer` 决定，即 `YUANCHAT_CODESENDER_API_KEY` ↔ `codesender.api_key`。

**每个 `codesender.*` 配置项都必须在 `Load()` 里有一行 `v.SetDefault`**。
`AutomaticEnv` 不会把未知 key 登记进 `AllKeys`，而 `Unmarshal` 只遍历 `AllKeys` ——
漏登记的症状是：env 填得好好的，容器里 `env | grep CODESENDER` 也看得到，
但程序读到空串，发码永远失败。`config_env_test.go` 专门盯着这件事，删掉任一
`SetDefault` 都会让它失败。

---

## 6. 复核提醒

- 本文价格全部于 **2026-10-06** 查询，均附来源链接。
  国内短信套餐包价格「可能随营销活动变动，具体价格以您登录订购页面显示的实际信息为准」（阿里云原文），
  腾讯云页面也标注部分档位在 2026-04-01 调过价。**下单前回原页面看一眼。**
- 资质政策变动比价格更频繁且更致命（「已上线 APP」签名来源被停用、
  腾讯云不再支持网站/公众号/小程序签名，都是近两年的变化）。
  如果距本文查询日期已超过三个月，§3.1 的结论需要重新核一遍。
- 本文标注「未能从官方文档确认」的项：华为云单价、AWS 中国单价、
  Vonage/Bird 全部数据、Twilio 试用额度细则、Firebase Phone Auth 单条费率、
  SendGrid 免费额度、Resend 免费档是否限制收件人。
  **这些是真的没查到，不是忘了填。需要时自己去官方控制台确认，不要从本文推断。**
