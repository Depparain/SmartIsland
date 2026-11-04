# Smart Island for Windows (MVP v0.1)

> Ultra-lightweight Dynamic Island desktop overlay for Windows 10/11 powered by **Tauri v2 (Rust)** and **React 19 + TypeScript**.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FRONTEND: WebView2 (React 19 + TS)                   │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌───────────────┐  │
│  │ Window Shell │ │  Tab Router  │ │ Zustand Store │ │ Framer Motion │  │
│  │ (Hover/Size) │ │ (6 Modules)  │ │ (State/Sync)  │ │ (60fps Spring)│  │
│  └──────┬───────┘ └──────┬───────┘ └───────┬───────┘ └───────────────┘  │
└─────────┼────────────────┼─────────────────┼────────────────────────────┘
          │ IPC Invoke     │ Tauri Events    │ WebSocket (127.0.0.1:9090)
┌─────────▼────────────────▼─────────────────┼────────────────────────────┐
│                   CORE BACKEND: Tauri v2 (Rust)                         │
│  ┌────────────────┐ ┌────────────────┐ ┌───┴────────────┐ ┌──────────┐  │
│  │ Window Manager │ │ WinRT / COM    │ │ Docker Client  │ │ Sidecar  │  │
│  │ (Win32 Hooks)  │ │ (Media/Audio/  │ │ (bollard via   │ │ Manager  │  │
│  │                │ │  Toast/Cal)    │ │  Named Pipe)   │ │          │  │
│  └────────────────┘ └───────┬────────┘ └───────┬────────┘ └────┬─────┘  │
└─────────────────────────────┼──────────────────┼───────────────┼────────┘
                              │                  │               │ Spawn
┌─────────────────────────────▼──────────────────▼───────────────▼────────┐
│                       OS & EXTERNAL SUBSYSTEMS                          │
│  [WinRT GSMTC / AudioPolicy]   [//./pipe/docker_engine]   [sing-box.exe]│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Functional Modules & Acceptance Criteria

### Epic 0: Core Shell & Window Physics
* **AC 0.1:** Idle window size is `180x32 px`. Clicks outside the capsule pass through to underlying windows.
* **AC 0.2:** On hover (`onMouseEnter`), the physical Tauri window expands to `480x300 px` and the UI smoothly expands via Framer Motion spring physics (`stiffness: 300, damping: 25`).
* **AC 0.3:** On cursor leave (`onMouseLeave`), the UI collapse animation completes first, and only on `onAnimationComplete` the physical window resizes back to `180x32 px`.
* **AC 0.4:** Auto-hides when a full-screen DirectX/D3D game is detected (`SHQueryUserNotificationState == QUNS_RUNNING_D3D_FULL_SCREEN`).

### Epic 1: Media Control (Player)
* **AC 1.1:** Track title, artist, and album art (converted from `IRandomAccessStreamReference` to base64 Data URL).
* **AC 1.2:** Play/Pause, Next, and Prev controls with sub-100ms response.
* **AC 1.3:** In Idle mode, mini album art with rotating disc and live equalizer indicator.

### Epic 2: Audio I/O Switcher
* **AC 2.1:** Active Render (Output) and Capture (Input) device lists; disconnected devices filtered out.
* **AC 2.2:** Click switches default endpoint for `eConsole` & `eCommunications` via COM `IPolicyConfig`.
* **AC 2.3:** Master volume slider controlling `IAudioEndpointVolume` with 2-way hardware volume sync.

### Epic 3: Notification Hub
* **AC 3.1:** WinRT `UserNotificationListener` permission check and request handling.
* **AC 3.2:** Recent 15 notifications with app name, title, body, and timestamp.
* **AC 3.3:** When a toast arrives in idle mode, expands to a `320x64 px` preview banner for 3 seconds.
* **AC 3.4:** "Clear all" clears notifications in both island state and Windows Action Center.

### Epic 4: Docker Manager
* **AC 4.1:** Async Docker client connected over Windows Named Pipe `//./pipe/docker_engine`. Clean fallback when daemon is off.
* **AC 4.2:** Container status badges, image names, and mapped ports.
* **AC 4.3:** Start, Stop, and Restart controls with async loading spinner.

### Epic 5: VPN & Proxy (Hybrid Xray-core + sing-box Dual Engine)
* **AC 5.1:** Universal config generator from proxy URI keys (`vless://`, `vmess://`, `ss://`, `trojan://`, `hysteria2://`, `tuic://`).
* **AC 5.2:** Dual-engine core auto-dispatch:
  * **Xray-core v26.10.31** for VLESS Reality (with Post-Quantum `mlkem768x25519plus` & `pqv=...`, `flow=xtls-rprx-vision`), VMess, Trojan, and Shadowsocks 2022.
  * **sing-box v1.14** for Hysteria 2 and TUIC.
* **AC 5.3:** Direct server IP bypass to prevent routing loops and guarantee seamless access to server admin panels (e.g. 3X-UI) and web portals.
* **AC 5.4:** System Proxy mode with instant WinINet refresh and full TUN interface mode.
* **AC 5.5:** Real-time delay / ping testing via native Rust proxy probe and WebSocket traffic streaming.
* **AC 5.6:** Windows Job Object lifecycle management: guaranteed child termination and proxy reset to `0` upon application exit.

### Epic 6: Settings & Personalization
* **AC 6.1:** Enable/disable and reorder tabs with instant navbar update.
* **AC 6.2:** Target display monitor selector (`window.available_monitors()`).
* **AC 6.3:** Light & Dark theme support with smooth reactive transitions.

---

## 3. Development & Build

### Running Frontend in Browser:
```bash
npm run dev
```

### Running Full Desktop App in Dev Mode:
```bash
npm run tauri dev
```

### Building Standalone Executable & Installers:
```bash
# Build standalone release executable:
npm run tauri build -- --no-bundle

# Build Windows NSIS setup (.exe) and MSI (.msi) installers:
npm run tauri build
```

Generated installer packages will be located in:
* `src-tauri/target/release/bundle/nsis/Smart Island_0.1.0_x64-setup.exe`
* `src-tauri/target/release/bundle/msi/Smart Island_0.1.0_x64_en-US.msi`
