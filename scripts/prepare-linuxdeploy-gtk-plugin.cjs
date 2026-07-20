const fs = require('fs');
const os = require('os');
const path = require('path');

const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
const pluginPath = path.join(cacheRoot, 'tauri', 'linuxdeploy-plugin-gtk.sh');
const pluginUrl =
  'https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh';
const marker = '# Preserve native Wayland sessions; do not force the AppImage onto X11.';

async function loadPlugin() {
  try {
    return fs.readFileSync(pluginPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(pluginUrl);
  if (!response.ok) {
    throw new Error(`Unable to download linuxdeploy GTK plugin: ${response.status}`);
  }
  return response.text();
}

async function main() {
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  const plugin = await loadPlugin();
  const patched = plugin.includes(marker)
    ? plugin
    : plugin.replace(
        /^export GDK_BACKEND=x11.*$/m,
        `${marker}\nif [ -z "\${GDK_BACKEND:-}" ] && [ -z "\${WAYLAND_DISPLAY:-}" ]; then\n  export GDK_BACKEND=x11\nfi`,
      );

  if (!patched.includes(marker)) {
    throw new Error('linuxdeploy GTK plugin no longer has the expected GDK_BACKEND override');
  }

  fs.writeFileSync(pluginPath, patched, { mode: 0o755 });
  fs.chmodSync(pluginPath, 0o755);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
