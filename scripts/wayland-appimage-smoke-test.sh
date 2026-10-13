#!/usr/bin/env bash
set -euo pipefail

appimage_path="$(realpath "${1:?usage: wayland-appimage-smoke-test.sh <AppImage>}")"

# Keep Weston, GTK and the AppImage in one session. GTK's Wayland backend is
# initialized by Tao before the app creates its WebView, so this must be a real
# GTK display check rather than a settings-only probe.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  exec dbus-run-session -- bash "$0" "$@"
fi

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

find_webkit_descendant() {
  local frontier="$1"
  local child executable next pid

  for _ in $(seq 1 8); do
    next=""
    for pid in $frontier; do
      while read -r child; do
        [ -n "$child" ] || continue
        executable="$(readlink "/proc/$child/exe" 2>/dev/null || true)"
        if [[ "$executable" == */WebKitWebProcess ]]; then
          echo "$child"
          return 0
        fi
        next="$next $child"
      done < <(pgrep -P "$pid" || true)
    done
    frontier="$next"
    [ -n "$frontier" ] || break
  done

  return 1
}

process_is_running() {
  local state
  kill -0 "$1" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$1" 2>/dev/null || true)"
  [ -n "$state" ] && [[ "$state" != *Z* ]]
}

chmod 700 "$runtime_dir"
export XDG_RUNTIME_DIR="$runtime_dir"
export WAYLAND_DISPLAY="minebench-wayland-0"
export XDG_SESSION_TYPE="wayland"
export GDK_BACKEND="wayland"

appimage_root="$runtime_dir/appimage-root"
mkdir "$appimage_root"
(
  cd "$appimage_root"
  "$appimage_path" --appimage-extract >/dev/null
  gtk_hook="squashfs-root/apprun-hooks/linuxdeploy-plugin-gtk.sh"
  test -f "$gtk_hook"
  env -u GDK_BACKEND WAYLAND_DISPLAY="$WAYLAND_DISPLAY" bash -c '
    source "$1"
    test "${GDK_BACKEND:-}" != x11
  ' bash "$gtk_hook"
)

# GitHub-hosted runners have no GPU/DRM device. Force Weston's software
# renderer so the compositor exposes a usable output to native GTK clients.
weston --backend=headless-backend.so --use-pixman --socket="$WAYLAND_DISPLAY" --no-config --log="$weston_log" &
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

if ! kill -0 "$weston_pid" 2>/dev/null; then
  cat "$weston_log" >&2
  echo "Wayland compositor exited before clients could connect" >&2
  exit 1
fi

gtk_ready=false
for _ in $(seq 1 40); do
  if python3 - >"$runtime_dir/gtk.log" 2>&1 <<'PY'
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

initialized = Gtk.init_check()
if isinstance(initialized, tuple):
    initialized = initialized[0]
if not initialized:
    raise SystemExit("Gtk.init_check() could not connect to the Wayland display")
PY
  then
    gtk_ready=true
    break
  fi
  sleep 0.25
done

if [ "$gtk_ready" != true ]; then
  cat "$weston_log" >&2
  cat "$runtime_dir/gtk.log" >&2
  echo "GTK could not connect to the native Wayland compositor" >&2
  exit 1
fi

env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage_path" >"$app_log" 2>&1 &
app_pid=$!

webkit_pid=""
for _ in $(seq 1 40); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$weston_log" >&2
    cat "$app_log" >&2
    echo "MineBench AppImage exited before creating its Wayland WebView" >&2
    exit 1
  fi
  webkit_pid="$(find_webkit_descendant "$app_pid" || true)"
  [ -n "$webkit_pid" ] && break
  sleep 0.25
done

if [ -z "$webkit_pid" ]; then
  cat "$app_log" >&2
  echo "MineBench AppImage did not create a WebKitWebProcess" >&2
  exit 1
fi

for _ in $(seq 1 40); do
  if ! process_is_running "$app_pid" || ! process_is_running "$webkit_pid"; then
    cat "$weston_log" >&2
    cat "$app_log" >&2
    echo "MineBench Wayland WebKitWebProcess exited before becoming stable" >&2
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
