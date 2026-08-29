package com.yuanchat.desktop

import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  /** WebView 引用：返回键委托与安全区下发都要用它 */
  private var webView: WebView? = null

  /** 最近一次量到的顶部安全区高度（CSS px），WebView 晚于 inset 回调创建时用它补发 */
  private var safeAreaTopCssPx = 0f

  // TauriActivity 本身已把它设为 false，这里显式重申：返回语义完全由前端决定。
  override val handleBackNavigation: Boolean = false

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    pushSafeAreaTop()
  }

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

    registerBackHandler()
    if (!edgeToEdge) return

    // 软键盘适配：targetSdk 35+ 的 Android 15 强制 edge-to-edge，旧的
    // windowSoftInputMode="adjustResize" 已失效，软键盘会以覆盖层浮在 WebView 上，
    // 导致 visualViewport 不收缩、底部输入框被遮挡。
    // 这里监听 IME inset，把键盘高度作为底部 padding 应用到内容根视图，
    // 内容区随之变矮 → WebView 的 visualViewport.height 收缩 →
    // 前端 useKeyboardAwareViewport 据此把 --app-height 改小、内容上移。
    //
    // 顶部**刻意不再** padding：那样会在状态栏位置留出一条窗口底色的空白，与应用背景
    // 断开，就是「没有沉浸式状态栏」的观感。改为让 WebView 铺到状态栏之下，
    // 把实测高度作为 --safe-area-top 下发给前端，由 .app-screen 自己留出内边距 ——
    // 应用背景（含深色模式）因此一直延伸到状态栏后面。
    // 左右仍按系统值 padding：刘海屏横屏时那是真正不可绘制的区域，
    // 交给 CSS 反而要多下发两个变量、收益为零。
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      view.setPadding(
        maxOf(bars.left, cutout.left),
        0,
        maxOf(bars.right, cutout.right),
        // 键盘弹起时用键盘高度，否则保留系统栏高度，避免内容被导航栏遮挡
        maxOf(ime, bars.bottom),
      )

      // inset 是物理像素，CSS 像素要除以 density，否则高分屏上会多留出两三倍的空白
      val density = resources.displayMetrics.density
      safeAreaTopCssPx = maxOf(bars.top, cutout.top) / density
      pushSafeAreaTop()
      insets
    }
  }

  /**
   * 把顶部安全区高度写进 CSS 自定义属性。
   *
   * 与 --app-height 同一套路：原生量、前端用。
   *
   * 必须重试：inset 回调与 onWebViewCreate 都发生在页面加载之前，那时 document 还是
   * about:blank，写进去的自定义属性会随文档被替换而丢失（实测表现为状态栏与内容重叠）。
   * 因此这里要等到真实文档就位（协议不是 about: 且已过 loading 阶段）才算写成功，
   * 否则每 250ms 重试，最多 ~5 秒。写成功后不再重试；旋转屏幕、显示切换会再次触发
   * inset 回调，届时重新写入。
   */
  private fun pushSafeAreaTop(retries: Int = 20) {
    val target = webView ?: return
    val value = "%.2f".format(safeAreaTopCssPx)
    target.evaluateJavascript(
      "(function(){" +
        "if(location.protocol==='about:'||document.readyState==='loading')return 'retry';" +
        "document.documentElement.style.setProperty('--safe-area-top','${value}px');" +
        "return 'ok'})()",
    ) { result ->
      if (result != "\"ok\"" && retries > 0) {
        target.postDelayed({ pushSafeAreaTop(retries - 1) }, 250)
      }
    }
  }

  /**
   * 在 WebView 之前拦下返回键。
   *
   * 关键点：`android.webkit.WebView` 自己会处理 KEYCODE_BACK —— 有历史就 `goBack()`
   * 并把事件吞掉，只有无历史可退时才漏给 Activity 的 OnBackPressedDispatcher。
   * 于是「在设置页按返回跳回上一个访问过的标签页」正是 WebView 在做 history.back()，
   * 我们注册的 dispatcher 回调根本没被调用（这也是最初「返回只会退出应用」的另一半原因：
   * 那种情形下 WebView 恰好没有历史）。
   *
   * 按键路径必须在 dispatchKeyEvent 这一层截断；手势返回在部分机型上走 dispatcher，
   * 因此两条路都保留，各自汇到同一个 handleBack()。DOWN 与 UP 都要吞，
   * 只在 UP 时执行，避免长按重复触发。
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_UP) handleBack()
    return true
  }

  /**
   * 返回键委托给前端。
   *
   * 前端 window.__androidBack__ 同步返回是否已消费本次返回：
   * true 表示它收起了弹窗 / 相机 / 内部栈或做了路由回退；false 表示已在根路由，
   * 此时才退出应用。前端还没挂上处理器时按原样退出，与改动前行为一致。
   */
  private fun registerBackHandler() {
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() = handleBack()
      },
    )
  }

  /**
   * 问前端要不要消费这次返回。
   *
   * 前端 window.__androidBack__ 同步返回 true 表示它收起了弹窗 / 相机 / 内部栈，
   * 或做了路由回退；返回 false 表示已在根页面且确认过退出意图，此时才 finish。
   * 前端还没挂上处理器（首帧之前）时按原样退出，与改动前行为一致。
   */
  private fun handleBack() {
    val target = webView
    if (target == null) {
      finish()
      return
    }
    target.evaluateJavascript(
      "(function(){try{return window.__androidBack__?window.__androidBack__():false}" +
        "catch(e){return false}})()",
    ) { result ->
      if (result != "true") finish()
    }
  }
}
