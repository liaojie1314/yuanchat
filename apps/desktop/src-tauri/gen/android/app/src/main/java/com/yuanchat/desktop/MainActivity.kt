package com.yuanchat.desktop

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 软键盘适配：targetSdk 35+ 的 Android 15 强制 edge-to-edge，旧的
    // windowSoftInputMode="adjustResize" 已失效，软键盘会以覆盖层浮在 WebView 上，
    // 导致 visualViewport 不收缩、底部输入框被遮挡。
    // 这里监听 IME inset，把键盘高度作为底部 padding 应用到内容根视图，
    // 内容区随之变矮 → WebView 的 visualViewport.height 收缩 →
    // 前端 useKeyboardAwareViewport 据此把 --app-height 改小、内容上移。
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val nav = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
      // 键盘弹起时用键盘高度，否则保留系统栏高度，避免内容被导航栏遮挡
      view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, maxOf(ime, nav))
      insets
    }
  }
}
