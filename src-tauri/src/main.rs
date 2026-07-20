// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn configure_linux_webkit_environment() {
    // WebKitGTK's DMA-BUF renderer can abort its WebProcess on some Wayland/Mesa
    // driver combinations. Keep accelerated compositing enabled and disable only
    // the incompatible buffer-sharing path for native Wayland sessions.
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_linux_webkit_environment();

    app_lib::run();
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvironmentRestore {
        wayland_display: Option<OsString>,
        dmabuf_renderer: Option<OsString>,
        compositing_mode: Option<OsString>,
    }

    impl EnvironmentRestore {
        fn capture() -> Self {
            Self {
                wayland_display: std::env::var_os("WAYLAND_DISPLAY"),
                dmabuf_renderer: std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
                compositing_mode: std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
            }
        }
    }

    impl Drop for EnvironmentRestore {
        fn drop(&mut self) {
            restore("WAYLAND_DISPLAY", self.wayland_display.take());
            restore(
                "WEBKIT_DISABLE_DMABUF_RENDERER",
                self.dmabuf_renderer.take(),
            );
            restore(
                "WEBKIT_DISABLE_COMPOSITING_MODE",
                self.compositing_mode.take(),
            );
        }
    }

    fn restore(name: &str, value: Option<OsString>) {
        if let Some(value) = value {
            std::env::set_var(name, value);
        } else {
            std::env::remove_var(name);
        }
    }

    #[test]
    fn linux_wayland_uses_the_safe_webkit_dmabuf_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _restore = EnvironmentRestore::capture();
        std::env::set_var("WAYLAND_DISPLAY", "wayland-0");
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");

        configure_linux_webkit_environment();

        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("1")
        );
        assert!(std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none());
    }

    #[test]
    fn linux_x11_keeps_webkit_default_rendering() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _restore = EnvironmentRestore::capture();
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");

        configure_linux_webkit_environment();

        assert!(std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none());
    }

    #[test]
    fn linux_wayland_respects_user_webkit_configuration() {
        let _guard = ENV_LOCK.lock().unwrap();
        let _restore = EnvironmentRestore::capture();
        std::env::set_var("WAYLAND_DISPLAY", "wayland-0");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");

        configure_linux_webkit_environment();

        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("0")
        );
    }
}
