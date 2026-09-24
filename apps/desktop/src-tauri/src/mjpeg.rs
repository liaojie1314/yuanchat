//! 帧广播 + 极简 MJPEG 服务 —— 把 GStreamer 解出来的画面搬进 WebView
//!
//! # 为什么需要这一层
//!
//! WebKitGTK 没有 `RTCPeerConnection`，远端视频自然也拿不到 `MediaStream`：
//! 画面在本进程的 GStreamer 里，而要显示它的 `<video>`/`<img>` 在 WebView 里，
//! 中间隔着进程边界。音频不存在这个问题 —— 直接进系统输出即可，不必回到 WebView。
//!
//! # 为什么是 MJPEG over 裸 TCP
//!
//! - **复用已有的 stdout 控制通道**：一帧几十 KB，塞进去会把 answer/candidate
//!   挤在后面排队，协商变慢；而 `emit` 是全局加锁的，帧会长期霸占那把锁
//! - **WebSocket**：要 SHA-1 握手加掩码解帧，得引依赖
//! - **MJPEG**：裸 HTTP，`multipart/x-mixed-replace` 用一条不结束的响应连续推帧，
//!   前端一个 `<img src>` 就显示，无需 canvas 或解码代码。已实测 WebKitGTK
//!   支持该类型且画面持续刷新（不是只显示首帧）
//!
//! # 访问控制
//!
//! 只绑 `127.0.0.1`，且 URL 路径带一枚随机 token。没有 token 的话，同机任何进程
//! 都能连上来围观用户的通话画面 —— 端口是固定可枚举的，这不是理论风险。
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// multipart 的分隔串，随便取但必须与 Content-Type 里声明的一致
const BOUNDARY: &str = "yuanchatframe";

/// 等一帧的上限。超时不是错误，只是回头看看这条流是否已经没了 ——
/// 没有它的话，通话结束后这些线程会永远挂在 `Condvar` 上。
const FRAME_WAIT: Duration = Duration::from_millis(500);

/// 连续多少次等不到帧就判定这条流已结束（× {@link FRAME_WAIT} = 10s）。
/// 给这么久是因为对端可能只是暂时关了摄像头，不该立刻断开 `<img>` 的连接。
const MAX_IDLE_ROUNDS: u32 = 20;

/// 写超时：客户端不读了（窗口关了、标签页挂起）时别让线程卡死在 write 上
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct Frames {
    /// stream_id → (JPEG 字节, 全局序号)。序号让等待方能判断「这帧我看过没有」
    map: HashMap<String, (Arc<Vec<u8>>, u64)>,
    seq: u64,
}

/// 帧的发布/订阅中枢，同时是 MJPEG 服务本身。
pub struct FrameHub {
    frames: Mutex<Frames>,
    /// 新帧到达的唤醒信号；订阅方全部挂在这上面
    signal: Condvar,
    token: String,
    port: u16,
}

static HUB: OnceLock<FrameHub> = OnceLock::new();

/// splitmix64 —— 由几个弱熵源混出难以猜中的 token。
///
/// 不是密码学用途：这枚 token 只用于挡住同机其它进程顺手连上来，
/// 真正的边界是「只监听 127.0.0.1」。为它引一个 rand 依赖不值得。
fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn random_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let pid = u64::from(std::process::id());
    // 栈地址：开了 ASLR 就是一份免费熵，没开也只是少一个混入源
    let stack = &nanos as *const u64 as u64;
    format!(
        "{:016x}{:016x}",
        mix(nanos ^ stack),
        mix(pid ^ nanos.rotate_left(17))
    )
}

/// 启动服务并返回可访问的基地址（形如 `http://127.0.0.1:41234/<token>`）。
///
/// 端口交给系统分配而不是写死：写死就会撞端口，而多开一个实例是完全正常的
/// （dev 与正式版同时跑）。前端的 CSP 因此按 `http://127.0.0.1:*` 放行。
pub fn start() -> Result<String, String> {
    if let Some(hub) = HUB.get() {
        return Ok(hub.base_url());
    }
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("视频服务监听失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("取视频服务端口失败: {e}"))?
        .port();
    let hub = HUB.get_or_init(|| FrameHub {
        frames: Mutex::new(Frames::default()),
        signal: Condvar::new(),
        token: random_token(),
        port,
    });

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            // 一个连接一个线程：同时最多 self + 3 个对端 = 4 条，不值得引线程池
            std::thread::spawn(move || serve(stream));
        }
    });
    Ok(hub.base_url())
}

/// 发布一帧。同 `stream_id` 的旧帧直接被覆盖 —— 慢的订阅方跳帧即可，
/// 排队只会让画面越来越延迟。
pub fn publish(stream_id: &str, jpeg: Vec<u8>) {
    let Some(hub) = HUB.get() else { return };
    if let Ok(mut guard) = hub.frames.lock() {
        guard.seq += 1;
        let seq = guard.seq;
        guard
            .map
            .insert(stream_id.to_string(), (Arc::new(jpeg), seq));
    }
    hub.signal.notify_all();
}

/// 撤下一条流。订阅方等不到新帧，会在 {@link MAX_IDLE_ROUNDS} 轮后自行退出。
pub fn drop_stream(stream_id: &str) {
    let Some(hub) = HUB.get() else { return };
    if let Ok(mut guard) = hub.frames.lock() {
        guard.map.remove(stream_id);
    }
    hub.signal.notify_all();
}

/// 清空全部流（通话整体结束）。
pub fn clear() {
    let Some(hub) = HUB.get() else { return };
    if let Ok(mut guard) = hub.frames.lock() {
        guard.map.clear();
    }
    hub.signal.notify_all();
}

impl FrameHub {
    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/{}", self.port, self.token)
    }
}

/// 处理一条连接：`GET /<token>/<stream_id>` → 一条永不结束的 multipart 响应。
fn serve(stream: TcpStream) {
    let Some(hub) = HUB.get() else { return };
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // 请求头必须读完：不读的话部分客户端会在我们开始写响应时收到 RST
    let mut header = String::new();
    while let Ok(n) = reader.read_line(&mut header) {
        if n == 0 || header.trim().is_empty() {
            break;
        }
        header.clear();
    }

    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let trimmed = path.trim_start_matches('/');
    let (token, stream_id) = trimmed.split_once('/').unwrap_or(("", ""));

    let mut writer = stream;
    let _ = writer.set_write_timeout(Some(WRITE_TIMEOUT));
    if token != hub.token || stream_id.is_empty() {
        let _ = writer.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
    }

    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: multipart/x-mixed-replace; boundary={BOUNDARY}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n"
    );
    if writer.write_all(headers.as_bytes()).is_err() {
        return;
    }

    let mut last_seq = 0u64;
    let mut idle = 0u32;
    loop {
        let frame = match next_frame(hub, stream_id, &mut last_seq) {
            Some(data) => {
                idle = 0;
                data
            }
            None => {
                idle += 1;
                if idle >= MAX_IDLE_ROUNDS {
                    return;
                }
                continue;
            }
        };
        let part = format!(
            "--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
            frame.len()
        );
        // 写失败 = 对端关了 <img>（换页、挂断），正常退出
        if writer.write_all(part.as_bytes()).is_err()
            || writer.write_all(&frame).is_err()
            || writer.write_all(b"\r\n").is_err()
            || writer.flush().is_err()
        {
            return;
        }
    }
}

/// 等到 `stream_id` 上出现比 `last_seq` 更新的一帧；超时返回 `None`。
fn next_frame(hub: &FrameHub, stream_id: &str, last_seq: &mut u64) -> Option<Arc<Vec<u8>>> {
    let mut guard = hub.frames.lock().ok()?;
    loop {
        if let Some((data, seq)) = guard.map.get(stream_id) {
            if *seq > *last_seq {
                *last_seq = *seq;
                return Some(data.clone());
            }
        }
        let (next, timeout) = hub.signal.wait_timeout(guard, FRAME_WAIT).ok()?;
        guard = next;
        if timeout.timed_out() {
            return None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{mix, random_token};

    /// token 必须每次不同且长度固定 —— 复用同一枚等于没有 token
    #[test]
    fn token_is_random_and_fixed_width() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// 混淆函数不能把相邻输入映射到相邻输出，否则 token 可被顺序猜测
    #[test]
    fn mix_avalanches() {
        let a = mix(1);
        let b = mix(2);
        assert_ne!(a, b);
        assert!((a ^ b).count_ones() > 8);
    }
}
