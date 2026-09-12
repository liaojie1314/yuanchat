//! Linux 桌面端通话媒体面的代理层（转发给独立的助手进程）
//!
//! # 为什么媒体面不在本进程
//!
//! Tauri 在 Linux 上用系统 WebKitGTK，而 **Ubuntu 与 GNOME 官方 Flatpak runtime 的
//! WebKitGTK 都没编进 GstWebRTC 后端**：`navigator.mediaDevices` 正常，
//! `RTCPeerConnection` 却整个类不存在（2.50.4 的 webkit2gtk-4.1 / webkitgtk-6.0
//! 四个构建实测一致）。两处独立打包都关着，说明是上游默认而非发行版取舍 ——
//! 「换一个 WebKitGTK 构建」这条路不存在。
//!
//! 于是媒体面下沉到 GStreamer，但**不能放在本进程**：
//!
//! ```text
//! WebKitGTK ────────────────────────────────> libsoup-3.0
//! webrtcbin ──> libnice ──> libgupnp-igd ──> libsoup-2.4
//! ```
//!
//! libsoup2 一旦发现进程里已有 libsoup3 符号就无条件 abort，没有环境变量开关，
//! LD_PRELOAD 也绕不过（实测）。触发点是**创建 `webrtcbin` 元件**的那一刻，
//! 不是 `gst::init()`。故媒体面整体搬进 [`call_helper`] 进程，两边各自持有自己的
//! libsoup。附带好处是 GStreamer 崩了只掉一次通话，主界面不受影响。
//!
//! 信令面**完全不动**：仍走既有 WebSocket 与 `peerMesh.ts`，前端经 `nativeRtc.ts`
//! 垫片把标准 `RTCPeerConnection` 调用转成这里的 command。
//!
//! # 互通性已实测
//!
//! webrtcbin 与系统真 Chrome 151 双向通音频（浏览器收 1088 包 / 本端收 36 包，
//! candidate-pair succeeded），系统 GStreamer 1.20.3 与 Flatpak 1.26.11 结果一致。
//!
//! [`call_helper`]: ../call_helper.rs
#![cfg(target_os = "linux")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// 助手进程的句柄与在途请求表。
struct Helper {
    child: Child,
    stdin: ChildStdin,
    /// 在途请求：id → 等待响应的发送端
    pending: HashMap<u64, Sender<Result<Value, String>>>,
}

static HELPER: OnceLock<Mutex<Option<Helper>>> = OnceLock::new();
static REQ_ID: AtomicU64 = AtomicU64::new(1);

fn helper_slot() -> &'static Mutex<Option<Helper>> {
    HELPER.get_or_init(|| Mutex::new(None))
}

/// 助手进程推上来的事件（转发给前端）。
#[derive(Debug, Serialize, Clone)]
struct PeerEvent {
    peer_id: String,
    /// `candidate` / `state` / `track`
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sdp_mline_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<String>,
}

/// 前端传来的一条 ICE 服务器配置。
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct IceServer {
    #[serde(default)]
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

/// 助手可执行文件的位置。
///
/// 开发时与主程序同在 `target/debug`；打包后经 `externalBin` 放进应用目录，
/// 同样与主程序同级。两种情况都落在「可执行文件所在目录」，故不必区分环境。
fn helper_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("取可执行文件路径失败: {e}"))?;
    let dir = exe.parent().ok_or("可执行文件没有父目录")?;
    // Tauri 的 externalBin 会把目标三元组附在文件名上，两种名字都找一遍
    for name in ["yuanchat-call-helper", "call_helper"] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("找不到通话助手进程".to_string())
}

/// 启动助手进程并挂上读取线程（幂等：已在跑就直接返回）。
fn ensure_helper(app: &AppHandle) -> Result<(), String> {
    let mut slot = helper_slot().lock().map_err(|_| "通话助手锁异常")?;
    if let Some(helper) = slot.as_mut() {
        // try_wait 为 Ok(None) 表示还活着；已退出的话下面重启一个
        if matches!(helper.child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }

    let path = helper_path()?;
    let mut child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("通话助手启动失败: {e}"))?;
    let stdin = child.stdin.take().ok_or("通话助手 stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("通话助手 stdout 不可用")?;

    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            // 有 id 的是响应，交回等待它的那次调用；其余是事件
            if let Some(id) = value.get("id").and_then(Value::as_u64) {
                let sender = helper_slot()
                    .lock()
                    .ok()
                    .and_then(|mut slot| slot.as_mut().and_then(|h| h.pending.remove(&id)));
                if let Some(sender) = sender {
                    let result = if value.get("ok").and_then(Value::as_bool) == Some(true) {
                        Ok(value.get("data").cloned().unwrap_or(Value::Null))
                    } else {
                        Err(value
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("通话助手未说明的失败")
                            .to_string())
                    };
                    let _ = sender.send(result);
                }
                continue;
            }
            let Some(event) = value.get("event").and_then(Value::as_str) else {
                continue;
            };
            if event == "ready" || event == "fatal" {
                continue;
            }
            let _ = app.emit(
                "native-rtc",
                PeerEvent {
                    peer_id: value
                        .get("peer_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    kind: event.to_string(),
                    candidate: value
                        .get("candidate")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    sdp_mline_index: value
                        .get("sdp_mline_index")
                        .and_then(Value::as_u64)
                        .map(|v| v as u32),
                    state: value
                        .get("state")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                },
            );
        }
    });

    *slot = Some(Helper {
        child,
        stdin,
        pending: HashMap::new(),
    });
    Ok(())
}

/// 发一条请求给助手进程并等响应。
fn call(app: &AppHandle, cmd: &str, mut payload: Value) -> Result<Value, String> {
    ensure_helper(app)?;
    let id = REQ_ID.fetch_add(1, Ordering::Relaxed);
    payload["id"] = json!(id);
    payload["cmd"] = json!(cmd);
    let line = format!("{payload}\n");

    let (tx, rx) = channel();
    {
        let mut slot = helper_slot().lock().map_err(|_| "通话助手锁异常")?;
        let helper = slot.as_mut().ok_or("通话助手未运行")?;
        helper.pending.insert(id, tx);
        helper
            .stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("写通话助手失败: {e}"))?;
        helper
            .stdin
            .flush()
            .map_err(|e| format!("写通话助手失败: {e}"))?;
    }
    // 助手侧协商自带 10s 上限，这里多给 5s 容纳进程调度
    rx.recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|_| "通话助手无响应".to_string())?
}

/// 本端是否真的能用原生通话。
///
/// 真去 make 一次元件而不是查版本号：插件装没装、装的哪个版本，只有实例化才知道。
/// 缺 `gstreamer1.0-plugins-bad` 时前端不装垫片，通话入口照旧收起来。
#[tauri::command]
pub fn native_rtc_available(app: AppHandle) -> bool {
    call(&app, "available", json!({}))
        .ok()
        .and_then(|v| v.get("audio").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// 视频是否可用（缺 vp8/v4l2 等插件时只有语音）。
///
/// 与 [`native_rtc_available`] 分开问：视频插件缺失不该让语音通话也一起不可用。
#[tauri::command]
pub fn native_rtc_video_available(app: AppHandle) -> bool {
    call(&app, "available", json!({}))
        .ok()
        .and_then(|v| v.get("video").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// 取本地 MJPEG 服务的基地址，前端据此拼出 `<img>` 的 src。
///
/// 按需启动：语音通话不会调到这里，也就不会白开一个监听端口。
#[tauri::command]
pub fn native_rtc_video_url(app: AppHandle) -> Result<String, String> {
    call(&app, "video_url", json!({}))?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "通话助手未返回视频地址".to_string())
}

/// 建一条到某个对端的连接。
#[tauri::command]
pub fn native_rtc_create(
    app: AppHandle,
    peer_id: String,
    ice_servers: Vec<IceServer>,
    media: String,
) -> Result<(), String> {
    call(
        &app,
        "create",
        json!({ "peer_id": peer_id, "ice_servers": ice_servers, "media": media }),
    )
    .map(|_| ())
}

/// 生成 offer（本端主动呼叫）。
#[tauri::command]
pub fn native_rtc_create_offer(app: AppHandle, peer_id: String) -> Result<String, String> {
    call(&app, "create_offer", json!({ "peer_id": peer_id }))?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "通话助手未返回 SDP".to_string())
}

/// 生成 answer（收到对端 offer 之后）。
#[tauri::command]
pub fn native_rtc_create_answer(app: AppHandle, peer_id: String) -> Result<String, String> {
    call(&app, "create_answer", json!({ "peer_id": peer_id }))?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "通话助手未返回 SDP".to_string())
}

/// 收下对端的 offer/answer。
#[tauri::command]
pub fn native_rtc_set_remote(
    app: AppHandle,
    peer_id: String,
    sdp_type: String,
    sdp: String,
) -> Result<(), String> {
    call(
        &app,
        "set_remote",
        json!({ "peer_id": peer_id, "sdp_type": sdp_type, "sdp": sdp }),
    )
    .map(|_| ())
}

/// 补一条对端 ICE 候选。
#[tauri::command]
pub fn native_rtc_add_candidate(
    app: AppHandle,
    peer_id: String,
    candidate: String,
    sdp_mline_index: u32,
) -> Result<(), String> {
    call(
        &app,
        "add_candidate",
        json!({
            "peer_id": peer_id,
            "candidate": candidate,
            "sdp_mline_index": sdp_mline_index,
        }),
    )
    .map(|_| ())
}

/// 静音/取消静音本端麦克风。
#[tauri::command]
pub fn native_rtc_set_muted(app: AppHandle, peer_id: String, muted: bool) -> Result<(), String> {
    call(
        &app,
        "set_muted",
        json!({ "peer_id": peer_id, "muted": muted }),
    )
    .map(|_| ())
}

/// 关/开摄像头。
///
/// 不带 `peer_id`：摄像头是全局共享的一路采集（V4L2 不允许多个打开者），
/// 关掉就是所有对端一起看不见。
#[tauri::command]
pub fn native_rtc_set_camera(app: AppHandle, off: bool) -> Result<(), String> {
    call(&app, "set_camera", json!({ "camera_off": off })).map(|_| ())
}

/// 拆掉一条连接。
#[tauri::command]
pub fn native_rtc_close(app: AppHandle, peer_id: String) -> Result<(), String> {
    call(&app, "close", json!({ "peer_id": peer_id })).map(|_| ())
}

/// 拆掉全部连接（通话结束、窗口关闭）。
#[tauri::command]
pub fn native_rtc_close_all(app: AppHandle) -> Result<(), String> {
    call(&app, "close_all", json!({})).map(|_| ())
}

/// 主进程退出时收掉助手进程。
///
/// 不杀的话助手会变成孤儿进程继续占着麦克风 —— 表现为应用关了摄像头/麦克风
/// 指示灯还亮着，下次启动还拿不到设备。
pub fn shutdown() {
    let Ok(mut slot) = helper_slot().lock() else {
        return;
    };
    if let Some(mut helper) = slot.take() {
        // 先关 stdin：助手读到 EOF 会自行停掉管线释放设备，比直接 kill 干净
        drop(helper.stdin);
        let _ = helper.child.wait();
    }
}
