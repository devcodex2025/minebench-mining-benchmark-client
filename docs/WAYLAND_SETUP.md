# Wayland support

MineBench Client uses Tauri and WebKitGTK on Linux. It does not use Electron or
Chromium/Ozone.

## Runtime policy

- Native Wayland is used whenever the desktop session provides `WAYLAND_DISPLAY`.
- Linux uses native window decorations and an opaque window. This avoids relying
  on compositor-specific transparent, frameless-window behaviour.
- On Linux, MineBench disables WebKitGTK's DMA-BUF renderer. WebKitGTK uses this
  path under Wayland, native X11 and XWayland, and incompatible Mesa/GBM drivers
  can otherwise leave the application with a blank WebView after its
  `WebKitWebProcess` aborts. Normal accelerated compositing remains enabled.
- The application never overwrites an explicit
  `WEBKIT_DISABLE_DMABUF_RENDERER` value supplied by the user or distributor.

The policy is implemented before Tauri creates a WebView in
`src-tauri/src/main.rs`. The Linux window configuration is kept separate in
`src-tauri/tauri.linux.conf.json`, so Windows retains its custom title bar.

## Supported environments

The release build is tested with both a native Wayland socket under headless
Weston and an X11 display under Xvfb. CI also launches the AppImage inside an
Ubuntu 26.04 userspace. Each smoke test verifies that the child
`WebKitWebProcess` is created and remains alive, rather than checking only the
Tauri parent process.

## Local verification

From a Linux desktop session:

```bash
npm ci
npm run dist:linux
appimage=$(find src-tauri/target -path '*/bundle/appimage/*.AppImage' -print -quit)
APPIMAGE_EXTRACT_AND_RUN=1 "$appimage"
```

The CI-equivalent smoke test requires Weston:

```bash
sudo apt install weston
appimage=$(find src-tauri/target -path '*/bundle/appimage/*.AppImage' -print -quit)
bash scripts/wayland-appimage-smoke-test.sh "$appimage"
bash scripts/x11-appimage-smoke-test.sh "$appimage"
```

`APPIMAGE_EXTRACT_AND_RUN=1` avoids a FUSE requirement during automated testing;
it does not alter the WebKitGTK or Wayland runtime path.

## Diagnostics

For a report, include these values and the application log:

```bash
echo "$XDG_SESSION_TYPE"
echo "$WAYLAND_DISPLAY"
echo "$WEBKIT_DISABLE_DMABUF_RENDERER"
```

If an issue reproduces only with a specific GPU driver, retain the GPU model,
driver version, compositor version and the complete `WebKitWebProcess` crash
output. Do not force `GDK_BACKEND=x11` as a general workaround: WebKitGTK can
use the failing DMA-BUF path under X11 too.
