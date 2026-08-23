package com.yuanchat.desktop

import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // edge-to-edge 只在 Android 11（API 30）及以上启用。
    // IME 的 inset 是 Android 11 才有的能力，更早的系统上
    // WindowInsetsCompat.Type.ime() 恒为 0；而 edge-to-edge
    // （decorFitsSystemWindows=false）又会一并停掉系统自己的窗口收缩，
    // 于是键盘既拿不到高度、窗口也不再变矮，输入框被键盘整块盖住。
    // 旧系统上不开 edge-to-edge，交回 manifest 里的 adjustResize：
    // 系统直接把窗口改矮，WebView 的 visualViewport 随之收缩，前端照旧生效。
    val edgeToEdge = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
    if (edgeToEdge) enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (!edgeToEdge) return

    // 软键盘适配：targetSdk 35+ 的 Android 15 强制 edge-to-edge，旧的
    // windowSoftInputMode="adjustResize" 已失效，软键盘会以覆盖层浮在 WebView 上，
    // 导致 visualViewport 不收缩、底部输入框被遮挡。
    // 这里监听 IME inset，把键盘高度作为底部 padding 应用到内容根视图，
    // 内容区随之变矮 → WebView 的 visualViewport.height 收缩 →
    // 前端 useKeyboardAwareViewport 据此把 --app-height 改小、内容上移。
    //
    // 顶部/左右同样要留出系统栏与刘海的高度：edge-to-edge 下 WebView 铺满整块屏幕，
    // 不减掉这些区域，页面标题栏就会压在状态栏文字下面。取系统实测值而非写死数值，
    // 才能覆盖刘海屏、挖孔屏、横屏等各种机型差异。
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      view.setPadding(
        maxOf(bars.left, cutout.left),
        maxOf(bars.top, cutout.top),
        maxOf(bars.right, cutout.right),
        // 键盘弹起时用键盘高度，否则保留系统栏高度，避免内容被导航栏遮挡
        maxOf(ime, bars.bottom),
      )
      insets
    }
  }
}
