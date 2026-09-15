/**
 * CallView 组件 — 通话主视图（来电 / 呼出 / 通话中三态同一组件）
 *
 * @description
 * 与挂载方式解耦的纯视图：只读 `callStore`、只发 4 个 `call.*` 帧。
 * Web / 移动端由 {@link CallHost} 挂成浮层，桌面端由独立窗口的 `/call` 路由挂成整页，
 * 两种挂载共用这一份代码。
 *
 * 三个必须放在一起才成立的设计点：
 *
 * 1. **最小化不卸载**：悬浮条与全屏态都由本组件渲染。若由宿主在两个组件间切换，
 *    `PeerMesh` 会随卸载被拆掉 —— 用户点一下「最小化」通话就断了。
 * 2. **媒体只在 `active` 态取**：来电/呼出期没有对端也没有本地轨；主叫的那一路
 *    由 {@link startCall} 在发 `call.invite` **之前**取好（权限被拒就不发起），
 *    经模块级 holder 交接过来，避免同一次通话连开两次摄像头。
 * 3. **信令先入队后订阅**：`call.signal` 帧必然早于 `PeerMesh` 就绪（要等
 *    `getUserMedia` + `fetchIceServers`），故走 `callSignalSink`，订阅时冲刷积压。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Minimize2, Phone, PhoneOff, RefreshCw, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  callSignalSink,
  chatSocket,
  fetchIceServers,
  PeerMesh,
  registerBackInterceptor,
  ringtone,
  showToast,
  useBreakpoint,
  useCallStore,
} from "@yuanchat/shared";
import type { CallParticipant } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import {
  constraintsOf,
  nativeVideoSrc,
  probeLocalMedia,
  stopStream,
  takeLocalStream,
  VIDEO_CONSTRAINTS,
} from "./callActions";
import { formatCallDuration } from "./callFormat";

/** 触控目标 44px：本仓根字号 14px，`min-h-11`(2.75rem) 只有 38.5px，不够手指点 */
const TOUCH = "min-h-[44px] min-w-[44px]";

/**
 * 远端画面。
 *
 * 两种取流方式：标准路径用 `<video srcObject>`；Linux 桌面端没有 WebRTC，
 * 画面由本地 MJPEG 服务推来，用 `<img>` 显示（见 {@link setNativeVideoResolver}）。
 * `srcObject` 只能用 ref 赋值，不能走 props。
 */
function RemoteTile({
  participant,
  stream,
  audioOnly,
}: {
  participant: CallParticipant;
  stream: MediaStream | undefined;
  audioOnly: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream ? stream : null;
  }, [stream]);

  const nativeSrc = audioOnly ? null : nativeVideoSrc(stream ? stream.id : undefined);
  // 有画面可显示时才让头像让位：语音通话、以及视频通话里画面还没到的那几秒，
  // 都该继续显示头像而不是一块黑
  const showPlaceholder = audioOnly || (!stream && !nativeSrc);

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
      {showPlaceholder ? (
        <div className="flex flex-col items-center gap-2">
          <Avatar name={participant.nickname} src={participant.avatar_url} size="xl" />
          <span className="text-label-md text-white/80">{participant.nickname}</span>
        </div>
      ) : null}
      {nativeSrc ? (
        <img src={nativeSrc} alt={participant.nickname} className="h-full w-full object-cover" />
      ) : (
        /* 语音通话也保留 video 元素承载音轨：单独建 audio 元素会在切换媒体时多一条生命周期 */
        <video
          ref={ref}
          autoPlay
          playsInline
          className={cn("h-full w-full object-cover", showPlaceholder ? "hidden" : "")}
        />
      )}
      <span className="text-label-sm absolute bottom-1 left-2 truncate text-white/70">
        {participant.nickname}
      </span>
    </div>
  );
}

/**
 * 本端自视画面。
 *
 * 两条取流路径与 {@link RemoteTile} 同理：标准路径是 `MediaStream`，Linux 桌面端
 * 的画面来自本地 MJPEG 服务 —— 摄像头已被 GStreamer 独占，WebView 再
 * `getUserMedia` 一次只会拿到 not-negotiated。
 *
 * 独立成组件是因为它要在「画中画」与「主画面」两个位置渲染（点击可对调），
 * 两处各写一份必然漏改其中一处。
 */
function LocalView({
  nativeSrc,
  videoRef,
  className,
}: {
  nativeSrc: string | null;
  /** 回调式 ref：本端 video 会在「画中画 / 主画面 / 网格格子」之间换挂载点，
      每次换都是一个新 DOM 元素，必须就地补 srcObject（它挂在元素实例上） */
  videoRef: (el: HTMLVideoElement | null) => void;
  className: string;
}) {
  if (nativeSrc) return <img src={nativeSrc} alt="" className={className} />;
  return <video ref={videoRef} autoPlay playsInline muted className={className} />;
}

/**
 * 群通话里代表自己的那一格。
 *
 * 1v1 不用它 —— 那里自己是画中画浮层（点击可与大画面对调）。三人及以上时浮层会压住
 * 别人的画面，且把自己算进去 4 人正好凑满 2×2，故改为占一格。
 */
function SelfTile({
  participant,
  nativeSrc,
  videoRef,
  showVideo,
}: {
  participant: CallParticipant | undefined;
  nativeSrc: string | null;
  videoRef: (el: HTMLVideoElement | null) => void;
  showVideo: boolean;
}) {
  const name = participant ? participant.nickname : "";
  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
      {showVideo ? (
        <LocalView
          nativeSrc={nativeSrc}
          videoRef={videoRef}
          className="h-full w-full object-cover"
        />
      ) : (
        <Avatar name={name || "?"} src={participant ? participant.avatar_url : null} size="xl" />
      )}
      <span className="text-label-sm absolute bottom-1 left-2 truncate text-white/70">{name}</span>
    </div>
  );
}

export function CallView() {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const phase = useCallStore((s) => s.phase);
  const media = useCallStore((s) => s.media);
  const callId = useCallStore((s) => s.callId);
  const selfConn = useCallStore((s) => s.selfConn);
  const participants = useCallStore((s) => s.participants);
  const caller = useCallStore((s) => s.caller);
  const minimized = useCallStore((s) => s.minimized);
  const muted = useCallStore((s) => s.muted);
  const cameraOff = useCallStore((s) => s.cameraOff);
  const startedAt = useCallStore((s) => s.startedAt);
  const setMinimized = useCallStore((s) => s.setMinimized);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleCamera = useCallStore((s) => s.toggleCamera);
  const reset = useCallStore((s) => s.reset);

  const meshRef = useRef<PeerMesh | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const facingRef = useRef<"user" | "environment">("user");
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});
  const [elapsed, setElapsed] = useState(0);
  /** 画中画与主画面是否已对调（点画中画切换） */
  const [swapped, setSwapped] = useState(false);
  const isVideo = media === "video";

  /** 除自己以外、已接听的对端连接（mesh 只对这些人建连） */
  const peerConns = useMemo(
    () =>
      participants
        .filter((p) => p.state === "joined" && !!p.conn_id && p.conn_id !== selfConn)
        .map((p) => p.conn_id),
    [participants, selfConn],
  );
  const peerKey = peerConns.join(",");

  /** 通话结束：本端立即出画，不等 `call.ended` —— 挂断后还留着界面像是没挂掉 */
  const leave = useCallback(() => {
    if (callId) chatSocket.send("call.leave", { call_id: callId });
    ringtone.playHangup();
    reset();
  }, [callId, reset]);

  const reject = useCallback(() => {
    if (callId) chatSocket.send("call.answer", { call_id: callId, accept: false });
    reset();
  }, [callId, reset]);

  const accept = useCallback(async () => {
    if (!callId) return;
    if (!(await probeLocalMedia(media))) {
      // 取不到设备就不能进房间：留在房里等于一个永远静音黑屏的参与者，
      // 房间还会因此撑到 60s 超时。直接离开，服务端按 failed 终结
      chatSocket.send("call.leave", { call_id: callId });
      reset();
      return;
    }
    chatSocket.send("call.answer", { call_id: callId, accept: true });
  }, [callId, media, reset]);

  // 铃声：三态各一种，其余静音
  useEffect(() => {
    if (phase === "incoming") ringtone.playIncoming();
    else if (phase === "outgoing") ringtone.playOutgoing();
    else ringtone.stop();
    return () => ringtone.stop();
  }, [phase]);

  // 通话计时器：1s 一跳，只在 active 且已记下开始时刻时跑
  useEffect(() => {
    if (phase !== "active" || startedAt === null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  // 媒体 + mesh 生命周期：只在 active 态建立，phase/callId 变化即整体重建
  useEffect(() => {
    if (phase !== "active" || !callId || !selfConn) return;
    let cancelled = false;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
        let stream = takeLocalStream();
        if (!stream) {
          if (!devices) throw new Error("no media devices");
          stream = await devices.getUserMedia(constraintsOf(media));
        }
        if (cancelled) {
          stopStream(stream);
          return;
        }
        localRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const iceServers = await fetchIceServers();
        if (cancelled) return;

        const mesh = new PeerMesh({
          selfConn,
          iceServers,
          onSignal: (toConn, data) => {
            chatSocket.send("call.signal", { call_id: callId, to_conn: toConn, data });
          },
          onRemoteStream: (connId, remote) => {
            setRemotes((prev) => ({ ...prev, [connId]: remote }));
          },
          onPeerGone: (connId) => {
            setRemotes((prev) => {
              const next = { ...prev };
              delete next[connId];
              return next;
            });
          },
        });
        mesh.setLocalStream(stream);
        meshRef.current = mesh;
        // 订阅放在 mesh 就位之后：sink 会把订阅前积压的帧一次性冲刷过来
        unsubscribe = callSignalSink.subscribe((p) => {
          void mesh.handleSignal(p.from_conn, p.data);
        });
        await mesh.syncPeers(peerConns);
      } catch {
        showToast("error", t("call.failedMedia"));
        leave();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      if (meshRef.current) {
        meshRef.current.close();
        meshRef.current = null;
      }
      stopStream(localRef.current);
      localRef.current = null;
      setRemotes({});
    };
    // peerConns 不进依赖：成员变更走下面的 syncPeers effect，进这里会整体重建连接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, callId, selfConn]);

  // 成员表变化 → 增量对齐连接集合（幂等，建新的拆走掉的）
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    void mesh.syncPeers(peerKey ? peerKey.split(",") : []);
  }, [peerKey]);

  // 静音 / 关摄像头：改的是轨道的 enabled，不重新协商（重新协商会让画面黑一下）
  useEffect(() => {
    const stream = localRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    for (let i = 0; i < tracks.length; i++) tracks[i].enabled = !muted;
  }, [muted]);

  useEffect(() => {
    const stream = localRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    for (let i = 0; i < tracks.length; i++) tracks[i].enabled = !cameraOff;
  }, [cameraOff]);

  // 安卓通话保活：接通期间把应用钉在前台，否则切后台几十秒进程就被回收、通话静默中断。
  // 该对象只在安卓原生 WebView 里存在（MainActivity 注入），其它平台恒为 undefined
  useEffect(() => {
    if (phase !== "active") return;
    const bridge = (
      window as unknown as {
        __yuanchatCall__?: {
          start(media: string, title: string, text: string): void;
          stop(): void;
        };
      }
    ).__yuanchatCall__;
    if (!bridge) return;
    bridge.start(media, t(isVideo ? "chat.videoCall" : "chat.voiceCall"), t("call.ongoing"));
    return () => bridge.stop();
  }, [phase, media, isVideo, t]);

  // 安卓返回键两层语义：来电态 = 拒接（最上层的打断必须能被返回键消掉），
  // 通话全屏态 = 最小化而非挂断（误触返回键就断线是最恼人的失误）
  useEffect(() => {
    return registerBackInterceptor(() => {
      if (phase === "incoming") {
        reject();
        return true;
      }
      if (phase === "outgoing") {
        leave();
        return true;
      }
      if (phase === "active" && !minimized) {
        setMinimized(true);
        return true;
      }
      return false;
    });
  }, [phase, minimized, reject, leave, setMinimized]);

  const switchCamera = useCallback(async () => {
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const mesh = meshRef.current;
    if (!devices || !mesh) return;
    const next = facingRef.current === "user" ? "environment" : "user";
    try {
      const stream = await devices.getUserMedia({
        audio: true,
        video: { ...VIDEO_CONSTRAINTS, facingMode: next },
      });
      facingRef.current = next;
      stopStream(localRef.current);
      localRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      mesh.setLocalStream(stream); // 同 kind 就地换轨，不会多出一路画面
    } catch {
      showToast("error", t("call.failedMedia"));
    }
  }, [t]);

  const peers = participants.filter((p) => p.conn_id !== selfConn);
  const title = caller !== null ? caller.nickname : peers.length > 0 ? peers[0].nickname : "";
  // 本端自视：关了摄像头就不该还显示自己的画面（原生那路送的是黑帧，
  // 但把 img 撤掉更直接，也省一条 HTTP 长连接）
  const localNativeSrc = isVideo && !cameraOff ? nativeVideoSrc("self") : null;
  // 只有 1:1 视频通话能对调：群通话把自己放大等于把其他人挤出画面
  const canSwap = isVideo && peers.length === 1;
  // 三人及以上的视频通话把自己也放进网格（浮层会压住别人，且 4 人正好凑满 2×2）。
  // 语音群通话不放 —— 那一格只会是自己的头像，没有任何新信息
  const selfInGrid = isVideo && peers.length > 1;
  const selfParticipant = participants.filter((p) => p.conn_id === selfConn)[0];
  // 对调状态必须跟 canSwap 一起判：对方中途离开时 peers 会空掉，
  // 只看 swapped 的话画中画会去取 peers[0] 而拿到 undefined
  const showSwapped = swapped && canSwap;

  /** 本端 video 的挂载点回调：换格子就是换 DOM 元素，srcObject 得跟着补一次 */
  const attachLocal = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localRef.current) el.srcObject = localRef.current;
  }, []);

  // 最小化：只留一条悬浮条。本组件不卸载，故 mesh 与本地轨全程存活
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        aria-label={t("call.restore")}
        className={cn(
          "bg-primary text-primary-on fixed right-4 z-[90] flex items-center gap-2 rounded-lg px-3 shadow-lg",
          TOUCH,
        )}
        style={{ top: "calc(var(--safe-area-top, 0px) + 4rem)" }}
      >
        <Phone size={16} />
        <span className="text-label-md font-medium">
          {phase === "active" ? formatCallDuration(elapsed) : t("call.connecting")}
        </span>
      </button>
    );
  }

  const ringingLabel = isVideo ? t("call.incomingVideo") : t("call.incoming");
  // 列数按**格子总数**算，不是按对端数：自己进网格时 4 人通话是 3 远端 + 1 自己
  const tileCount = peers.length + (selfInGrid ? 1 : 0);
  const gridCols = tileCount <= 1 ? "grid-cols-1" : "grid-cols-2";

  return (
    <div
      className={cn(
        "fixed inset-0 flex flex-col bg-black/95",
        phase === "incoming" ? "z-[110]" : "z-[100]",
      )}
      // 全屏浮层贴顶：安卓沉浸式状态栏由原生下发 --safe-area-top，Web/桌面回退 0
      style={{ paddingTop: "var(--safe-area-top, 0px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={phase === "incoming" ? ringingLabel : t("chat.voiceCall")}
    >
      {/* 桌面端通话在独立窗口里，且窗口关掉了系统边框（与主窗口、登录窗口一致），
          必须自己给一条拖拽区，否则窗口按不住也拖不动。
          `data-tauri-drag-region` 在非 Tauri 环境（Web/安卓浮层）只是个无人认识的
          data 属性，不会有任何影响，故无需按平台分支。
          高度取 32px：够按住，又不会盖到下面的参与者画面与右上角按钮。 */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-8" />
      {phase === "active" ? (
        <>
          <div className={cn("grid min-h-0 flex-1 gap-2 p-2", gridCols)}>
            {showSwapped ? (
              <LocalView
                nativeSrc={localNativeSrc}
                videoRef={attachLocal}
                className="h-full w-full rounded-lg bg-black/40 object-cover"
              />
            ) : (
              peers.map((p) => (
                <RemoteTile
                  key={p.conn_id || p.user_id}
                  participant={p}
                  stream={remotes[p.conn_id]}
                  audioOnly={!isVideo}
                />
              ))
            )}
            {/* 自己那一格排在最后：新人加入时从末尾追加，已在画面上的人不会左右跳动 */}
            {selfInGrid && (
              <SelfTile
                participant={selfParticipant}
                nativeSrc={localNativeSrc}
                videoRef={attachLocal}
                showVideo={!cameraOff}
              />
            )}
          </div>
          {/* 本地画中画：仅 1:1 视频通话。三人及以上自己已在网格里占一格。
              Linux 桌面端的自视同样来自 MJPEG 服务 —— 摄像头已被 GStreamer 独占，
              WebView 再 getUserMedia 一次只会拿到 not-negotiated */}
          {isVideo && !selfInGrid && (
            <button
              type="button"
              onClick={() => canSwap && setSwapped((v) => !v)}
              aria-label={t("call.swapView")}
              // 不能对调时不该显示成可点（对方还没进来，没有可换的画面）
              disabled={!canSwap}
              className={cn(
                "absolute right-3 h-32 w-24 overflow-hidden rounded-lg shadow-lg",
                canSwap ? "cursor-pointer" : "cursor-default",
              )}
              style={{ top: "calc(var(--safe-area-top, 0px) + 0.75rem)" }}
            >
              {showSwapped ? (
                <RemoteTile
                  participant={peers[0]}
                  stream={remotes[peers[0].conn_id]}
                  audioOnly={!isVideo}
                />
              ) : (
                <LocalView
                  nativeSrc={localNativeSrc}
                  videoRef={attachLocal}
                  className="h-full w-full bg-black/40 object-cover"
                />
              )}
            </button>
          )}
          <p className="text-label-md pb-1 text-center text-white/70">
            {formatCallDuration(elapsed)}
          </p>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          {/* 呼出多人时必须把被叫全列出来：只显示 peers[0] 的话，勾了 Bob + Carol
              却只看见 Bob，用户无从判断另一个人有没有被叫到 */}
          {phase !== "incoming" && peers.length > 1 ? (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 px-4">
              {peers.map((p) => (
                <div key={p.conn_id || p.user_id} className="flex flex-col items-center gap-1.5">
                  <Avatar name={p.nickname} src={p.avatar_url} size="lg" />
                  <span className="text-label-md max-w-24 truncate text-white/80">
                    {p.nickname}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <Avatar
                name={title || "?"}
                src={caller !== null ? caller.avatar_url : null}
                size="xl"
              />
              <h2 className="text-title-md font-semibold text-white">{title}</h2>
            </>
          )}
          <p className="text-body-md text-white/70">
            {phase === "incoming" ? ringingLabel : t("call.calling")}
          </p>
        </div>
      )}

      {/* 控制条：来电态是接听/拒绝两键，其余是完整控制 */}
      <div
        className="flex shrink-0 items-center justify-center gap-4 px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        {phase === "incoming" ? (
          <>
            <button
              onClick={reject}
              aria-label={t("call.reject")}
              className={cn(
                "flex items-center justify-center rounded-full bg-red-500 text-white",
                TOUCH,
              )}
            >
              <PhoneOff size={22} />
            </button>
            <button
              onClick={() => void accept()}
              aria-label={t("call.accept")}
              className={cn(
                "flex items-center justify-center rounded-full bg-emerald-500 text-white",
                TOUCH,
              )}
            >
              <Phone size={22} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleMute}
              aria-label={muted ? t("call.unmute") : t("call.mute")}
              className={cn(
                "flex items-center justify-center rounded-full bg-white/15 text-white",
                TOUCH,
              )}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            {isVideo && (
              <button
                onClick={toggleCamera}
                aria-label={cameraOff ? t("call.cameraOn") : t("call.cameraOff")}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/15 text-white",
                  TOUCH,
                )}
              >
                {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
            )}
            {isVideo && bp === "mobile" && (
              <button
                onClick={() => void switchCamera()}
                aria-label={t("call.switchCamera")}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/15 text-white",
                  TOUCH,
                )}
              >
                <RefreshCw size={20} />
              </button>
            )}
            {phase === "active" && (
              <button
                onClick={() => setMinimized(true)}
                aria-label={t("call.minimize")}
                className={cn(
                  "flex items-center justify-center rounded-full bg-white/15 text-white",
                  TOUCH,
                )}
              >
                <Minimize2 size={20} />
              </button>
            )}
            <button
              onClick={leave}
              aria-label={t("call.hangup")}
              className={cn(
                "flex items-center justify-center rounded-full bg-red-500 text-white",
                TOUCH,
              )}
            >
              <PhoneOff size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
