//! 通话助手进程的入口 —— 实现体在 [`../call_helper.rs`]，这里只做平台分流。
//!
//! 助手只在 Linux 上存在意义（Windows 的 WebView2 与 macOS 的 WKWebView 自带
//! WebRTC），而它的实现整体依赖 GStreamer —— 那是个 `cfg(target_os = "linux")`
//! 的依赖。但 `cargo build` 会构建包里的**每一个** bin，不认这份平台差异：
//! 实现体若直接放在 `src/bin/` 下，Windows/macOS/Android 上编到这个 target 时
//! `use gstreamer` 找不到 crate，整个构建就挂了（CI 的 tauri-action 走的正是
//! `cargo build --release`）。
//!
//! 故实现体挪出 `src/bin/`（放在那儿会被 cargo 自动认成又一个 bin target），
//! 由这里按平台 `#[path]` 引入：非 Linux 上整个模块不进编译，只留一个空 main。
#[cfg(target_os = "linux")]
#[path = "../mjpeg.rs"]
mod mjpeg;

#[cfg(target_os = "linux")]
#[path = "../call_helper.rs"]
mod call_helper;

#[cfg(target_os = "linux")]
fn main() {
    call_helper::main();
}

/// 非 Linux 平台不需要助手，留个空壳让这个 bin target 仍能编过。
#[cfg(not(target_os = "linux"))]
fn main() {}
