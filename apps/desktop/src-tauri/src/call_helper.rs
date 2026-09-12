//! 通话媒体助手进程 —— Linux 上把 GStreamer 隔离在主进程之外
//!
//! # 为什么必须是独立进程
//!
//! 主进程里**同时存在 WebKitGTK 与 webrtcbin 是不可能的**：
//!
//! ```text
//! WebKitGTK ────────────────────────────────> libsoup-3.0
//! webrtcbin ──> libnice ──> libgupnp-igd ──> libsoup-2.4
//! ```
//!
//! 而 libsoup2 一旦发现进程里已有 libsoup3 符号就**无条件 abort**
//! （"Using libsoup2 and libsoup3 in the same process is not supported"，
//! 该检查没有任何环境变量开关，实测 LD_PRELOAD 也绕不过）。注意触发点不是
//! `gst::init()` —— 单独 init 不加载 libnice，是**创建 `webrtcbin` 元件**那一刻
//! 才把整条链拽进来。所以「不用 webrtcbin 就没事」，而我们恰恰要用。
//!
//! 把媒体面放进独立进程后两边各自持有自己的 libsoup，互不可见。附带好处是
//! GStreamer 崩了只掉一次通话，主界面不受影响。
//!
//! # 协议
//!
//! stdin 逐行收 JSON 请求，stdout 逐行回 JSON 响应/事件。选行分隔 JSON 而不是
//! 更正式的 RPC：一问一答外加几种事件推送，用不上更重的东西。
//!
//! 请求 `{"id":<n>,"cmd":"...","...":...}`，响应 `{"id":<n>,"ok":true,"data":...}`
//! 或 `{"id":<n>,"ok":false,"error":"..."}`；事件 `{"event":"...","peer_id":"..."}`。

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use gstreamer as gst;
use gstreamer::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 单条对端连接：独立 pipeline，便于随对端加入/离开单独起停。
struct Peer {
    pipeline: gst::Pipeline,
    webrtc: gst::Element,
    /// 本端麦克风静音开关（`volume` 元件）
    volume: gst::Element,
    /// 视频通话才有：共享采集把编码好的 VP8 帧推进这里
    video_src: Option<gst::Element>,
}

/// 共享摄像头采集。
///
/// 为什么不能像麦克风那样每条连接各采一份：PulseAudio 允许多个客户端同时读同一个
/// 输入源，V4L2 不允许 —— 实测第二个打开 `/dev/video0` 的进程直接
/// `not-negotiated`。而 mesh 拓扑下每个对端各有一条 pipeline，照搬音频的做法在
/// 第二个人加入时必然拿不到摄像头。
///
/// 故采集独立成一条 pipeline，**编码也只做一次**，再把编码后的 VP8 帧分发给每个
/// 对端的 `appsrc`。顺带省下 N-1 次编码 —— vp8enc 是整条链路最吃 CPU 的一环。
struct Capture {
    pipeline: gst::Pipeline,
    /// 摄像头 / 黑帧两路输入的切换器（关摄像头 = 切到黑帧）
    selector: gst::Element,
    camera_pad: Option<gst::Pad>,
    black_pad: Option<gst::Pad>,
}

static PEERS: OnceLock<Mutex<HashMap<String, Peer>>> = OnceLock::new();
static CAPTURE: OnceLock<Mutex<Option<Capture>>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

fn peers() -> &'static Mutex<HashMap<String, Peer>> {
    PEERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn capture() -> &'static Mutex<Option<Capture>> {
    CAPTURE.get_or_init(|| Mutex::new(None))
}

/// 前端传来的一条 ICE 服务器配置（形状与 `RTCIceServer` 对齐）。
#[derive(Debug, Deserialize)]
struct IceServer {
    #[serde(default)]
    urls: Vec<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    credential: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    cmd: String,
    #[serde(default)]
    peer_id: String,
    #[serde(default)]
    ice_servers: Vec<IceServer>,
    #[serde(default)]
    sdp_type: String,
    #[serde(default)]
    sdp: String,
    #[serde(default)]
    candidate: String,
    #[serde(default)]
    sdp_mline_index: u32,
    #[serde(default)]
    muted: bool,
    /// `"video"` 才开摄像头；缺省按语音处理
    #[serde(default)]
    media: String,
    #[serde(default)]
    camera_off: bool,
}

#[derive(Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// 往 stdout 写一行 JSON。
///
/// 全局加锁：事件由 GStreamer 的信号回调线程发出，与主线程的响应并发写同一个
/// stdout，不加锁会交错成半行 JSON，另一端直接解析失败。
fn emit(value: &Value) {
    static OUT: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = OUT.get_or_init(|| Mutex::new(())).lock();
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}

/// TURN 凭据里的保留字符必须转义后才能塞进 URI 的 userinfo。
///
/// 服务端下发的密码是 `base64(HMAC-SHA1(...))`，`+` `/` `=` 都是 base64 字母表的
/// 常客，而它们在 URI 里各有含义 —— 不转义的话解析出来的密码与真实密码不符，
/// TURN 静默返回 401，表现为「只有同网段能通」。
fn percent_encode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() * 3);
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 把 ICE 配置挂到 webrtcbin 上。
///
/// 全部失败也不报错：仅 host 候选在同网段仍可通，此时 UI 已在「连接中」，
/// 直接失败反而丢掉唯一可能连上的机会。
fn apply_ice_servers(webrtc: &gst::Element, servers: &[IceServer]) {
    let mut stun_set = false;
    for server in servers {
        for url in &server.urls {
            let is_turn = url.starts_with("turn:") || url.starts_with("turns:");
            if !is_turn {
                if !stun_set && url.starts_with("stun:") {
                    webrtc.set_property("stun-server", url);
                    stun_set = true;
                }
                continue;
            }
            let Some((scheme, host)) = url.split_once(':') else {
                continue;
            };
            let uri = match (&server.username, &server.credential) {
                (Some(user), Some(pass)) => format!(
                    "{}://{}:{}@{}",
                    scheme,
                    percent_encode(user),
                    percent_encode(pass),
                    host
                ),
                _ => format!("{scheme}://{host}"),
            };
            let _ = webrtc.emit_by_name::<bool>("add-turn-server", &[&uri]);
        }
    }
}

/// 采集规格。640×480@15 是「看得清脸」与「vp8enc 在老机器上也追得上实时」的折中，
/// 再高会让编码跟不上采集，表现为对端画面一顿一顿而不是变清晰。
const VIDEO_CAPS: &str = "video/x-raw,width=640,height=480,framerate=15/1";

/// 本端自视画面：只占屏幕角落一小块，按采集分辨率编 JPEG 纯属浪费带宽与 CPU
const PREVIEW_CAPS: &str = "video/x-raw,width=320,height=240";

/// 远端画面转 JPEG 前的上限。对端可能推 720p 上来，原样转 JPEG 会让
/// 单帧涨到几百 KB，本地环回也扛不住
const REMOTE_CAPS: &str = "video/x-raw,width=640,height=480";

/// 本端自视流在 MJPEG 服务里的固定 id（对端流用各自的 peer_id）
const SELF_STREAM: &str = "self";

/// 按名字取一个请求 pad（`input-selector` 的 sink_%u 不是 static pad，
/// `static_pad()` 取不到，只能遍历）
fn find_pad(element: &gst::Element, name: &str) -> Option<gst::Pad> {
    element.pads().into_iter().find(|p| p.name() == name)
}

/// 把 appsink 的每一帧 JPEG 发布到 MJPEG 服务上。
fn publish_frames_from(sink: &gst::Element, stream_id: String) {
    sink.set_property("emit-signals", true);
    let _ = sink.connect("new-sample", false, move |values| {
        let sink = values.first()?.get::<gst::Element>().ok()?;
        // pull-sample 走信号而不是 gstreamer-app 的类型化 API：为一个取样动作
        // 多引一个 crate 不划算，签名固定后也不容易写错
        let sample = sink.emit_by_name::<Option<gst::Sample>>("pull-sample", &[])?;
        let buffer = sample.buffer()?;
        let map = buffer.map_readable().ok()?;
        crate::mjpeg::publish(&stream_id, map.as_slice().to_vec());
        Some(gst::FlowReturn::Ok.to_value())
    });
}

/// 起共享采集。已在跑就直接复用（第二个对端加入时不该重开摄像头）。
///
/// 摄像头打不开（被别的程序占着、根本没有）时退化成纯黑帧而不是整通电话失败：
/// 视频通话里对方至少还能听见你，比连不上强。
fn ensure_capture() -> Result<(), String> {
    let mut slot = capture().lock().map_err(|_| "采集状态锁异常")?;
    if slot.is_some() {
        return Ok(());
    }

    // 摄像头与黑帧两路都接进 input-selector：关摄像头时切到黑帧而不是断流。
    // 断流的话对端抖动缓冲会把最后一帧冻在屏幕上，看起来像卡死而不是「他关了摄像头」
    let common = format!("videoconvert ! videoscale ! videorate ! {VIDEO_CAPS}");
    let base = format!(
        "input-selector name=sel ! tee name=vt \
         vt. ! queue leaky=downstream max-size-buffers=2 ! videoscale ! {PREVIEW_CAPS} ! \
         jpegenc quality=60 ! appsink name=preview max-buffers=1 drop=true sync=false \
         vt. ! queue leaky=downstream max-size-buffers=4 ! \
         vp8enc deadline=1 keyframe-max-dist=30 ! \
         appsink name=enc max-buffers=2 drop=true sync=false \
         videotestsrc pattern=black is-live=true ! {common} ! sel.sink_1"
    );
    let with_camera = format!("v4l2src ! {common} ! sel.sink_0 {base}");

    let (pipeline, has_camera) = match build_capture(&with_camera) {
        Ok(p) => (p, true),
        Err(e) => {
            emit(&json!({ "event": "warn", "error": format!("摄像头不可用，改发黑帧: {e}") }));
            (build_capture(&base)?, false)
        }
    };

    let selector = pipeline.by_name("sel").ok_or("找不到 input-selector")?;
    let camera_pad = if has_camera {
        find_pad(&selector, "sink_0")
    } else {
        None
    };
    let black_pad = find_pad(&selector, "sink_1");
    // 没摄像头时 sink_0 不存在，active-pad 默认就是黑帧那路
    if let Some(pad) = camera_pad.as_ref() {
        selector.set_property("active-pad", pad);
    }

    if let Some(preview) = pipeline.by_name("preview") {
        publish_frames_from(&preview, SELF_STREAM.to_string());
    }
    if let Some(enc) = pipeline.by_name("enc") {
        enc.set_property("emit-signals", true);
        let _ = enc.connect("new-sample", false, |values| {
            let sink = values.first()?.get::<gst::Element>().ok()?;
            let sample = sink.emit_by_name::<Option<gst::Sample>>("pull-sample", &[])?;
            let buffer = sample.buffer()?;
            fanout_encoded(buffer);
            Some(gst::FlowReturn::Ok.to_value())
        });
    }

    *slot = Some(Capture {
        pipeline,
        selector,
        camera_pad,
        black_pad,
    });
    Ok(())
}

/// 建并启动采集 pipeline，确认真的进了 Playing 才算成功。
///
/// `set_state` 返回 Ok 不代表起来了 —— v4l2 的失败是异步的，必须再 `state()`
/// 等一次状态确认，否则「摄像头被占用」会一路装作没事直到画面全黑。
fn build_capture(description: &str) -> Result<gst::Pipeline, String> {
    let pipeline = gst::parse::launch(description)
        .map_err(|e| format!("采集管线创建失败: {e}"))?
        .downcast::<gst::Pipeline>()
        .map_err(|_| "采集管线类型异常".to_string())?;
    pipeline
        .set_state(gst::State::Playing)
        .map_err(|e| format!("采集管线启动失败: {e}"))?;
    let (result, _, _) = pipeline.state(gst::ClockTime::from_seconds(5));
    if result.is_err() {
        let _ = pipeline.set_state(gst::State::Null);
        return Err("采集管线未能进入 Playing".to_string());
    }
    Ok(pipeline)
}

/// 把一帧编码后的 VP8 分发给所有视频对端。
fn fanout_encoded(buffer: &gst::BufferRef) {
    // 时间戳必须清掉：采集与每条对端 pipeline 各有自己的 base-time，沿用采集侧的
    // PTS 会让 rtpvp8pay 收到相对自己不单调的时间戳，直接停止发包（画面永远不出现）。
    // 清空后由 appsrc 的 do-timestamp 按本 pipeline 的运行时重新打点
    let mut owned = buffer.to_owned();
    {
        let raw = owned.make_mut();
        raw.set_pts(gst::ClockTime::NONE);
        raw.set_dts(gst::ClockTime::NONE);
    }

    let Ok(guard) = peers().lock() else { return };
    for peer in guard.values() {
        // caps 在建连时就设好了（协商需要），这里不再动它
        if let Some(src) = peer.video_src.as_ref() {
            let _ = src.emit_by_name::<gst::FlowReturn>("push-buffer", &[&owned]);
        }
    }
}

/// 停掉采集并释放摄像头（最后一个视频对端离开时）。
fn stop_capture() {
    if let Ok(mut slot) = capture().lock() {
        if let Some(cap) = slot.take() {
            // 必须显式置 Null，否则摄像头灯会一直亮着
            let _ = cap.pipeline.set_state(gst::State::Null);
        }
    }
    crate::mjpeg::drop_stream(SELF_STREAM);
}

/// 关/开摄像头：切 input-selector 的活动 pad。
///
/// 不停采集是刻意的 —— 停了再开有一两秒的设备初始化，用户会以为按钮卡住。
/// 代价是关摄像头期间摄像头指示灯仍亮，这一点在设计文档里已注明。
fn set_camera_off(off: bool) -> Result<(), String> {
    let slot = capture().lock().map_err(|_| "采集状态锁异常")?;
    let Some(cap) = slot.as_ref() else {
        return Ok(()); // 语音通话没有采集，静默忽略
    };
    let target = if off {
        cap.black_pad.as_ref()
    } else {
        cap.camera_pad.as_ref().or(cap.black_pad.as_ref())
    };
    if let Some(pad) = target {
        cap.selector.set_property("active-pad", pad);
    }
    Ok(())
}

/// 远端媒体到达：接上解码与播放。
///
/// 用 `decodebin` 而不是写死 `rtpopusdepay ! opusdec`：编码由协商结果决定，
/// 写死一种等于赌对端也选了它。音频直接进系统默认输出，不回传主进程 ——
/// 声音不需要渲染，多一次跨进程搬运只会增加延迟。视频则相反，必须搬回
/// WebView 才看得见，故转成 JPEG 走 MJPEG 服务（见 [`crate::mjpeg`]）。
fn on_incoming_stream(pipeline: &gst::Pipeline, pad: &gst::Pad, peer_id: &str) {
    if pad.direction() != gst::PadDirection::Src {
        return;
    }
    let Ok(decodebin) = gst::ElementFactory::make("decodebin").build() else {
        return;
    };
    let pipeline_weak = pipeline.downgrade();
    let owner = peer_id.to_string();
    decodebin.connect_pad_added(move |_, src_pad| {
        let Some(pipeline) = pipeline_weak.upgrade() else {
            return;
        };
        let media = src_pad
            .current_caps()
            .and_then(|caps| caps.structure(0).map(|s| s.name().to_string()))
            .unwrap_or_default();
        let description = if media.starts_with("audio/") {
            "queue ! audioconvert ! audioresample ! autoaudiosink".to_string()
        } else if media.starts_with("video/") {
            format!(
                "queue leaky=downstream max-size-buffers=2 ! videoconvert ! videoscale ! \
                 {REMOTE_CAPS} ! jpegenc quality=70 ! \
                 appsink name=out max-buffers=1 drop=true sync=false"
            )
        } else {
            return;
        };
        let Ok(sink) = gst::parse::bin_from_description(&description, true) else {
            return;
        };
        if pipeline.add(&sink).is_err() {
            return;
        }
        // 帧的发布要在 bin 进 pipeline 之后接：接早了 appsink 还没有父级，
        // 信号连上也收不到样本
        if let Some(out) = sink
            .downcast_ref::<gst::Bin>()
            .and_then(|b| b.by_name("out"))
        {
            publish_frames_from(&out, owner.clone());
        }
        let _ = sink.sync_state_with_parent();
        if let Some(target) = sink.static_pad("sink") {
            let _ = src_pad.link(&target);
        }
    });

    if pipeline.add(&decodebin).is_err() {
        return;
    }
    let _ = decodebin.sync_state_with_parent();
    if let Some(target) = decodebin.static_pad("sink") {
        let _ = pad.link(&target);
    }
}

/// 建一条到某个对端的连接。
///
/// 麦克风在这里就接上：SDP 必须在 `create-offer` 之前就含音频 m-line，
/// 等接通后再加轨道要重新协商，对端会经历一次声音中断。视频同理 —— 视频通话
/// 的 `appsrc` 分支也必须在协商前就位，哪怕此刻还没有一帧数据。
fn create_peer(peer_id: &str, ice_servers: &[IceServer], video: bool) -> Result<(), String> {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    // bundle-policy=max-bundle 与浏览器默认一致；不一致会让 SDP 多出一组 m-line，
    // 部分浏览器直接判为不兼容
    let mut description = format!(
        "webrtcbin name=wb{seq} bundle-policy=max-bundle latency=100 \
         pulsesrc ! audioconvert ! audioresample ! volume name=vol{seq} ! queue ! \
         opusenc ! rtpopuspay ! \
         application/x-rtp,media=audio,encoding-name=OPUS,payload=111 ! wb{seq}."
    );
    if video {
        // 帧由共享采集推进来，故这里是 appsrc 而不是 v4l2src。
        // do-timestamp=true：采集与本 pipeline 是两条时间线，沿用原 PTS 会让
        // rtpvp8pay 拿到相对自己 base-time 不单调的时间戳，直接不发包
        description.push_str(&format!(
            " appsrc name=vsrc{seq} is-live=true format=time do-timestamp=true ! \
             rtpvp8pay ! application/x-rtp,media=video,encoding-name=VP8,payload=96 ! wb{seq}."
        ));
    }
    let pipeline = gst::parse::launch(&description)
        .map_err(|e| format!("通话管线创建失败: {e}"))?
        .downcast::<gst::Pipeline>()
        .map_err(|_| "通话管线类型异常".to_string())?;

    let webrtc = pipeline
        .by_name(&format!("wb{seq}"))
        .ok_or("找不到 webrtcbin")?;
    let volume = pipeline
        .by_name(&format!("vol{seq}"))
        .ok_or("找不到 volume")?;
    let video_src = if video {
        let src = pipeline.by_name(&format!("vsrc{seq}"));
        // appsrc 必须自己声明格式：它不像 v4l2src 那样能从设备推断，没有 caps 的话
        // 推进来的 buffer 下游无从解释，rtpvp8pay 直接 not-negotiated。
        // 这里敢写死 VP8 是因为喂它的就是本进程的采集，编码器是我们自己选的
        if let Some(src) = src.as_ref() {
            src.set_property("caps", gst::Caps::builder("video/x-vp8").build());
        }
        src
    } else {
        None
    };

    apply_ice_servers(&webrtc, ice_servers);

    // libnice 的 UPnP 端口映射对我们毫无用处（TURN 已覆盖对称 NAT），
    // 却会在每次建连时做一轮 SSDP 发现，白等几秒
    if let Ok(ice) = webrtc
        .property::<gst::glib::Object>("ice-agent")
        .downcast::<gst::glib::Object>()
    {
        if let Ok(agent) = ice
            .property::<gst::glib::Object>("agent")
            .downcast::<gst::glib::Object>()
        {
            agent.set_property("upnp", false);
        }
    }

    let id_ice = peer_id.to_string();
    webrtc.connect("on-ice-candidate", false, move |values| {
        let mline = values.get(1).and_then(|v| v.get::<u32>().ok()).unwrap_or(0);
        let candidate = values
            .get(2)
            .and_then(|v| v.get::<String>().ok())
            .unwrap_or_default();
        emit(&json!({
            "event": "candidate",
            "peer_id": id_ice,
            "candidate": candidate,
            "sdp_mline_index": mline,
        }));
        None
    });

    let id_state = peer_id.to_string();
    webrtc.connect_notify(Some("connection-state"), move |element, _| {
        let state = element
            .property::<gst::glib::Value>("connection-state")
            .serialize()
            .map(|s| s.to_string())
            .unwrap_or_default();
        emit(&json!({ "event": "state", "peer_id": id_state, "state": state }));
    });

    let pipeline_weak = pipeline.downgrade();
    let id_track = peer_id.to_string();
    webrtc.connect_pad_added(move |_, pad| {
        if let Some(pipeline) = pipeline_weak.upgrade() {
            on_incoming_stream(&pipeline, pad, &id_track);
        }
        emit(&json!({ "event": "track", "peer_id": id_track }));
    });

    pipeline
        .set_state(gst::State::Playing)
        .map_err(|e| format!("通话管线启动失败: {e}"))?;

    peers().lock().map_err(|_| "通话状态锁异常")?.insert(
        peer_id.to_string(),
        Peer {
            pipeline,
            webrtc,
            volume,
            video_src,
        },
    );
    // 采集放在最后起：起早了而 pipeline 建失败的话，摄像头会一直被占着
    if video {
        ensure_capture()?;
    }
    Ok(())
}

fn with_peer<T>(peer_id: &str, f: impl FnOnce(&Peer) -> T) -> Result<T, String> {
    let guard = peers().lock().map_err(|_| "通话状态锁异常")?;
    let peer = guard
        .get(peer_id)
        .ok_or_else(|| format!("连接不存在: {peer_id}"))?;
    Ok(f(peer))
}

/// 造 offer/answer 并就地 set-local-description。
///
/// 两步合一是刻意的：回调里拿到的是原生会话描述对象，跨进程只能退化成 SDP
/// 字符串再解析回来，白白多一轮解析且可能丢属性。主进程侧的
/// `setLocalDescription` 因此是空转。
fn negotiate(peer_id: &str, kind: &'static str) -> Result<String, String> {
    let webrtc = with_peer(peer_id, |p| p.webrtc.clone())?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let webrtc_for_cb = webrtc.clone();
    let promise = gst::Promise::with_change_func(move |reply| {
        let result = (|| {
            let reply = reply
                .map_err(|e| format!("协商失败: {e:?}"))?
                .ok_or("协商无返回")?;
            let desc = reply
                .value(kind)
                .map_err(|_| format!("协商缺少 {kind}"))?
                .get::<gstreamer_webrtc::WebRTCSessionDescription>()
                .map_err(|e| format!("协商结果类型异常: {e}"))?;
            let sdp = desc
                .sdp()
                .as_text()
                .map_err(|e| format!("SDP 序列化失败: {e}"))?;
            webrtc_for_cb
                .emit_by_name::<()>("set-local-description", &[&desc, &None::<gst::Promise>]);
            Ok(sdp)
        })();
        let _ = tx.send(result);
    });
    webrtc.emit_by_name::<()>(
        if kind == "offer" {
            "create-offer"
        } else {
            "create-answer"
        },
        &[&None::<gst::Structure>, &promise],
    );
    // 协商是本地计算，正常毫秒级返回；给 10s 是防止元件异常时通话界面卡死
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "协商超时".to_string())?
}

fn close_peer(peer_id: &str) -> Result<(), String> {
    let (peer, video_left) = {
        let mut guard = peers().lock().map_err(|_| "通话状态锁异常")?;
        let peer = guard.remove(peer_id);
        let left = guard.values().any(|p| p.video_src.is_some());
        (peer, left)
    };
    if let Some(peer) = peer {
        // 必须显式置 Null：drop 不会释放麦克风，下一通电话就拿不到设备
        let _ = peer.pipeline.set_state(gst::State::Null);
    }
    crate::mjpeg::drop_stream(peer_id);
    // 最后一个视频对端走了才收摄像头 —— 群通话里还有人在看画面时不能关
    if !video_left {
        stop_capture();
    }
    Ok(())
}

fn close_all() -> Result<(), String> {
    let drained: Vec<Peer> = {
        let mut guard = peers().lock().map_err(|_| "通话状态锁异常")?;
        guard.drain().map(|(_, peer)| peer).collect()
    };
    for peer in drained {
        let _ = peer.pipeline.set_state(gst::State::Null);
    }
    stop_capture();
    crate::mjpeg::clear();
    Ok(())
}

/// 通话链路的必需元件；缺任何一个都说明插件没装齐。
const REQUIRED_ELEMENTS: [&str; 4] = ["webrtcbin", "nicesink", "opusenc", "rtpopuspay"];

/// 视频额外需要的元件。单独一组是因为缺它们只该让视频不可用，
/// 而不是把语音通话也一起判死 —— 语音是更基本的能力。
const VIDEO_ELEMENTS: [&str; 6] = [
    "v4l2src",
    "vp8enc",
    "vp8dec",
    "rtpvp8pay",
    "jpegenc",
    "input-selector",
];

fn handle(req: &Request) -> Result<Value, String> {
    match req.cmd.as_str() {
        // 判「元件能否实例化」而不是版本号：插件装没装只有真 make 一次才知道
        "available" => Ok(json!({
            "audio": REQUIRED_ELEMENTS
                .iter()
                .all(|n| gst::ElementFactory::make(n).build().is_ok()),
            "video": VIDEO_ELEMENTS
                .iter()
                .all(|n| gst::ElementFactory::make(n).build().is_ok()),
        })),
        // 视频服务按需启动：语音通话不必开这个端口
        "video_url" => crate::mjpeg::start().map(Value::from),
        "create" => {
            create_peer(&req.peer_id, &req.ice_servers, req.media == "video").map(|_| Value::Null)
        }
        "create_offer" => negotiate(&req.peer_id, "offer").map(Value::from),
        "create_answer" => negotiate(&req.peer_id, "answer").map(Value::from),
        "set_remote" => {
            let webrtc = with_peer(&req.peer_id, |p| p.webrtc.clone())?;
            let message = gstreamer_sdp::SDPMessage::parse_buffer(req.sdp.as_bytes())
                .map_err(|e| format!("SDP 解析失败: {e}"))?;
            let kind = if req.sdp_type == "offer" {
                gstreamer_webrtc::WebRTCSDPType::Offer
            } else {
                gstreamer_webrtc::WebRTCSDPType::Answer
            };
            let desc = gstreamer_webrtc::WebRTCSessionDescription::new(kind, message);
            webrtc.emit_by_name::<()>("set-remote-description", &[&desc, &None::<gst::Promise>]);
            Ok(Value::Null)
        }
        "add_candidate" => {
            let webrtc = with_peer(&req.peer_id, |p| p.webrtc.clone())?;
            webrtc.emit_by_name::<()>("add-ice-candidate", &[&req.sdp_mline_index, &req.candidate]);
            Ok(Value::Null)
        }
        // 改 volume 而不是停 pulsesrc：停源会断 RTP，对端抖动缓冲会当成掉线
        "set_muted" => {
            with_peer(&req.peer_id, |p| p.volume.set_property("mute", req.muted))?;
            Ok(Value::Null)
        }
        // 摄像头是全局共享的一路采集，故不按 peer 分别处理
        "set_camera" => set_camera_off(req.camera_off).map(|_| Value::Null),
        "close" => close_peer(&req.peer_id).map(|_| Value::Null),
        "close_all" => close_all().map(|_| Value::Null),
        other => Err(format!("未知命令: {other}")),
    }
}

pub fn main() {
    if let Err(e) = gst::init() {
        emit(&json!({ "event": "fatal", "error": format!("gstreamer 初始化失败: {e}") }));
        std::process::exit(1);
    }
    emit(&json!({ "event": "ready" }));

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(req) => match handle(&req) {
                Ok(data) => Response {
                    id: req.id,
                    ok: true,
                    data: Some(data),
                    error: None,
                },
                Err(error) => Response {
                    id: req.id,
                    ok: false,
                    data: None,
                    error: Some(error),
                },
            },
            // 解析不出 id 就没法对应请求，只能报事件
            Err(e) => {
                emit(&json!({ "event": "fatal", "error": format!("请求解析失败: {e}") }));
                continue;
            }
        };
        if let Ok(value) = serde_json::to_value(&response) {
            emit(&value);
        }
    }
    // stdin 关闭 = 主进程退出，释放麦克风后一起走
    let _ = close_all();
}

#[cfg(test)]
mod tests {
    use super::percent_encode;

    /// base64 凭据里的 `+` `/` `=` 必须转义 —— 不转义会让 TURN 静默 401，
    /// 表现为「只有同网段能通」，是最难查的那类故障
    #[test]
    fn percent_encode_escapes_base64_chars() {
        assert_eq!(percent_encode("ab+/c="), "ab%2B%2Fc%3D");
        assert_eq!(percent_encode("1700000000:u1"), "1700000000%3Au1");
        assert_eq!(percent_encode("aZ0-._~"), "aZ0-._~");
    }
}
