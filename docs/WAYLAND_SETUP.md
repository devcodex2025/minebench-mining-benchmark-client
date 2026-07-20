# Wayland support

MineBench Client uses Tauri and WebKitGTK on Linux. It does not use Electron or
Chromium/Ozone.

## Runtime policy

- Native Wayland is used whenever the desktop session provides `WAYLAND_DISPLAY`.
- Linux uses native window decorations and an opaque window. This avoids relying
  on compositor-specific transparent, frameless-window behaviour.
- On Wayland only, MineBench disables WebKitGTK's DMA-BUF renderer. This is a
  targeted compatibility setting for the upstream WebKitGTK driver crash; normal
  accelerated compositing remains enabled.
- The application never overwrites an explicit
  `WEBKIT_DISABLE_DMABUF_RENDERER` value supplied by the user or distributor.

The policy is implemented before Tauri creates a WebView in
`src-tauri/src/main.rs`. The Linux window configuration is kept separate in
`src-tauri/tauri.linux.conf.json`, so Windows retains its custom title bar.

## Supported environments

The release build is tested with a native Wayland socket and headless Weston.
This verifies the AppImage, Tauri, WebKitGTK and the Linux window configuration
together. It is not an X11/XWayland test.

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
output. Do not force `GDK_BACKEND=x11` as a general workaround: that would hide
a native Wayland regression from the supported path.
