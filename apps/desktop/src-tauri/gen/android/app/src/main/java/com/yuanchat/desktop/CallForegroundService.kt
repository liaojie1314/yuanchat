package com.yuanchat.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * 通话前台服务：通话期间把应用钉在前台，避免系统回收进程导致通话中断。
 *
 * 没有它的表现是「锁屏或切到别的应用几十秒后就掉话」—— 进程被回收时
 * WebSocket 与全部 PeerConnection 一起消失，对端只看到本端静默离开。
 *
 * 三处容易踩的系统约束：
 * - **服务类型**：Android 10（API 29）起 `startForeground` 要带类型，
 *   14（API 34）起类型必须与清单里声明的一致且有对应权限，否则抛
 *   `SecurityException`。这里用 `ServiceCompat` 统一处理各版本差异。
 * - **通知渠道**：API 26 起必须先建渠道，否则通知根本不显示（服务照样跑，
 *   但用户看不到自己还在通话中）。渠道重要性取 `LOW`：通话本身有铃声与界面，
 *   通知只是保活载体，用 `DEFAULT` 会在每次通话开始时再响一声。
 * - **点击回到应用**：`MainActivity` 是 `launchMode="singleTask"`，
 *   配合 `FLAG_ACTIVITY_SINGLE_TOP` 不会新开一个实例（新实例意味着 WebView
 *   重建，通话直接没了）。
 *
 * 文案由前端经 [CallBridge] 传入而不是走 Android 资源：应用内语言是用户在设置里
 * 选的，与系统语言无关，`values-xx/strings.xml` 跟不上它。
 */
class CallForegroundService : Service() {
  companion object {
    private const val TAG = "CallForegroundService"
    private const val CHANNEL_ID = "yuanchat_call"
    private const val NOTIF_ID = 4101

    const val EXTRA_MEDIA = "media"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val media = intent?.getStringExtra(EXTRA_MEDIA) ?: "audio"
    val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty()
    val text = intent?.getStringExtra(EXTRA_TEXT).orEmpty()

    createChannel()
    try {
      ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(title, text), typeOf(media))
    } catch (e: Exception) {
      // 保活失败不该连通话一起搞崩：没有前台服务只是后台更容易被回收，
      // 前台使用期间通话仍然正常
      Log.w(TAG, "启动前台服务失败，通话切后台可能被回收", e)
      stopSelf()
    }
    // STICKY 会在进程被杀后用空 Intent 重启本服务，而那时通话早已不存在，
    // 只会留下一条撤不掉的常驻通知
    return START_NOT_STICKY
  }

  /** 按媒体形态给出前台服务类型；API 30 以下传 0（系统不支持细分类型）。 */
  private fun typeOf(media: String): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return 0
    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    if (media == "video") type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    return type
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
      NotificationChannel(CHANNEL_ID, "Call", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        enableVibration(false)
        setSound(null, null)
      }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val intent =
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
    val pending =
      PendingIntent.getActivity(
        this,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setContentTitle(title.ifEmpty { getString(R.string.app_name) })
      .setContentText(text)
      .setContentIntent(pending)
      .setOngoing(true) // 不可滑动清除：清掉通知等于让系统失去保活依据
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()
  }
}

/**
 * 通话保活桥：暴露给 WebView 的 `window.__yuanchatCall__`。
 *
 * 走 `addJavascriptInterface` 而不是 `#[tauri::command]`：Rust 侧要调 Android API
 * 得引 jni + ndk-context 并手写 JNI 调用，而 [MainActivity] 本来就是已定制的
 * （返回键、安全区都在里面），桥接方向反过来一次即可。
 *
 * @property context 用于启停服务的 Activity 上下文
 */
class CallBridge(private val context: Context) {
  /**
   * 通话接通时拉起前台服务。
   *
   * @param media `"audio"` 或 `"video"`，决定前台服务类型
   * @param title 常驻通知标题（已由前端按当前语言产出）
   * @param text 常驻通知正文
   */
  @android.webkit.JavascriptInterface
  fun start(media: String, title: String, text: String) {
    val intent =
      Intent(context, CallForegroundService::class.java).apply {
        putExtra(CallForegroundService.EXTRA_MEDIA, media)
        putExtra(CallForegroundService.EXTRA_TITLE, title)
        putExtra(CallForegroundService.EXTRA_TEXT, text)
      }
    // startForegroundService 而非 startService：API 26+ 后台启动普通服务会被拒，
    // 且必须在 5 秒内调到 startForeground，否则系统抛 ANR 级别的异常
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  /** 通话结束时停掉前台服务（常驻通知随之消失）。 */
  @android.webkit.JavascriptInterface
  fun stop() {
    context.stopService(Intent(context, CallForegroundService::class.java))
  }
}
