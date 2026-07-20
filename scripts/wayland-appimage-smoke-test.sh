#!/usr/bin/env bash
set -euo pipefail

appimage_path="${1:?usage: wayland-appimage-smoke-test.sh <AppImage>}"
runtime_dir="$(mktemp -d)"
weston_log="$runtime_dir/weston.log"
app_log="$runtime_dir/minebench.log"
weston_pid=""
app_pid=""

cleanup() {
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  [ -n "$weston_pid" ] && kill "$weston_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  wait "$weston_pid" 2>/dev/null || true
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

chmod 700 "$runtime_dir"
export XDG_RUNTIME_DIR="$runtime_dir"
export WAYLAND_DISPLAY="minebench-wayland-0"
export XDG_SESSION_TYPE="wayland"
export GDK_BACKEND="wayland"

weston --backend=headless-backend.so --socket="$WAYLAND_DISPLAY" --no-config --log="$weston_log" &
weston_pid=$!

for _ in $(seq 1 40); do
  [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ] && break
  sleep 0.25
done

if [ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
  cat "$weston_log" >&2
  echo "Wayland compositor did not start" >&2
  exit 1
fi

APPIMAGE_EXTRACT_AND_RUN=1 "$appimage_path" >"$app_log" 2>&1 &
app_pid=$!

for _ in $(seq 1 40); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$app_log" >&2
    echo "MineBench AppImage exited before its Wayland WebView became stable" >&2
    exit 1
  fi
  sleep 0.25
done

if grep -Eqi 'WebKitWebProcess.*(abort|crash|core dumped)|Gdk-Message:.*Protocol error' "$app_log"; then
  cat "$app_log" >&2
  echo "MineBench AppImage reported a WebKitGTK/Wayland crash" >&2
  exit 1
fi

echo "Wayland AppImage smoke test passed"
