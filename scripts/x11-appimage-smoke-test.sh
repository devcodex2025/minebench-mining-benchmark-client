#!/usr/bin/env bash
set -euo pipefail

appimage_path="$(realpath "${1:?usage: x11-appimage-smoke-test.sh <AppImage>}")"

if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  exec dbus-run-session -- bash "$0" "$@"
fi

if [ -z "${DISPLAY:-}" ]; then
  exec xvfb-run -a bash "$0" "$@"
fi

runtime_dir="$(mktemp -d)"
app_log="$runtime_dir/minebench.log"
app_pid=""

cleanup() {
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

export GDK_BACKEND="x11"
export XDG_SESSION_TYPE="x11"
unset WAYLAND_DISPLAY

env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage_path" >"$app_log" 2>&1 &
app_pid=$!

webkit_pid=""
for _ in $(seq 1 40); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$app_log" >&2
    echo "MineBench AppImage exited before creating its X11 WebView" >&2
    exit 1
  fi
  webkit_pid="$(pgrep -P "$app_pid" -f '/WebKitWebProcess' | head -n 1 || true)"
  [ -n "$webkit_pid" ] && break
  sleep 0.25
done

if [ -z "$webkit_pid" ]; then
  cat "$app_log" >&2
  echo "MineBench AppImage did not create a WebKitWebProcess" >&2
  exit 1
fi

for _ in $(seq 1 40); do
  if ! kill -0 "$app_pid" 2>/dev/null || ! kill -0 "$webkit_pid" 2>/dev/null; then
    cat "$app_log" >&2
    echo "MineBench X11 WebKitWebProcess exited before becoming stable" >&2
    exit 1
  fi
  sleep 0.25
done

if grep -Eqi 'WebKitWebProcess.*(abort|crash|core dumped)|Gdk-Message:.*Protocol error|Failed to create GBM buffer' "$app_log"; then
  cat "$app_log" >&2
  echo "MineBench AppImage reported a WebKitGTK/X11 graphics failure" >&2
  exit 1
fi

echo "X11 AppImage smoke test passed"
