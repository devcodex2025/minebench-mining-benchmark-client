import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('Tauri updater is configured for signed Bitbucket artifacts', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const native = read('src-tauri/src/lib.rs');
  const capabilities = JSON.parse(read('src-tauri/capabilities/desktop.json'));
  const commands = read('src-tauri/src/commands.rs');

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.ok(
    config.plugins.updater.endpoints.some((url: string) => /bitbucket\.org/.test(url)),
    'the signed artifacts still come from the download area'
  );
  assert.ok(config.plugins.updater.pubkey.length > 40);
  assert.match(cargo, /tauri-plugin-updater = "2"/);
  assert.match(native, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.ok(capabilities.permissions.includes('updater:default'));
  assert.match(commands, /\| "bitbucket\.org"/);
});

test('update button installs through Tauri on every platform', () => {
  const service = read('src/services/appUpdate.ts');
  const state = read('src/services/appUpdateState.ts');

  assert.match(service, /downloadAndInstall/);
  assert.match(service, /await withTimeout\(/);
  assert.match(state, /install: installAppUpdate/);
});

test('the title bar and Settings share one synchronized update store', () => {
  const titleBar = read('src/components/TitleBar.tsx');
  const settings = read('src/pages/Settings.tsx');
  const state = read('src/services/appUpdateState.ts');

  for (const [name, source] of [['TitleBar', titleBar], ['Settings', settings]] as const) {
    assert.match(source, /useAppUpdate\(\)/, `${name} must read the shared update state`);
    assert.match(source, /checkForUpdate/, `${name} must trigger the shared check`);
    assert.match(source, /startUpdate/, `${name} must trigger the shared install`);
    assert.doesNotMatch(source, /installAppUpdate/, `${name} must not install on its own`);
    assert.doesNotMatch(
      source,
      /const \[installingUpdate/,
      `${name} must not keep a private install flag`
    );
  }

  assert.match(state, /createAppUpdateStore\(\{/);
  assert.match(state, /checkStatus: getAppUpdateStatus/);
  assert.match(state, /install: installAppUpdate/);
});

test('one updater manifest covers the Windows and Linux builds', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));

  // "all" bundles the Windows installers and the Linux AppImage from the same
  // config, and the single Bitbucket manifest carries one entry per platform, so
  // the synchronized install flow behaves the same on both systems.
  assert.equal(config.bundle.targets, 'all');
  assert.equal(config.plugins.updater.windows.installMode, 'passive');
  assert.ok(config.bundle.windows.nsis, 'Windows bundle settings must stay declared');
});

test('the permanent entry point comes first and the working address still follows', () => {
  const endpoints: string[] = JSON.parse(read('src-tauri/tauri.conf.json')).plugins.updater
    .endpoints;

  // The updater moves on to the next URL when one fails, so a channel whose entry
  // point is not configured yet still updates from where the files actually are.
  assert.equal(endpoints.length, 2);
  assert.ok(endpoints[0].startsWith('https://updates.minebench.cloud/stable/'), endpoints[0]);
  assert.ok(endpoints[1].endsWith('/downloads/latest.json'), endpoints[1]);

  // Every channel is scoped to its own entry point, so a misconfigured redirect
  // cannot serve another channel's build.
  for (const [file, channel] of [
    ['src-tauri/tauri.canary.conf.json', 'canary'],
    ['src-tauri/tauri.nightly.conf.json', 'nightly'],
  ] as const) {
    const channelEndpoints: string[] = JSON.parse(read(file)).plugins.updater.endpoints;
    assert.ok(channelEndpoints[0].endsWith(`/${channel}/latest.json`), channelEndpoints[0]);
    assert.ok(channelEndpoints[1].endsWith(`/${channel}-latest.json`), channelEndpoints[1]);
  }
});

test('a client installed before the permanent entry point still updates', () => {
  const stable = JSON.parse(read('src-tauri/tauri.conf.json'));
  const tooling = read('scripts/channel.mjs');

  // The unprefixed manifest is the address every pre-0.9 client is compiled with,
  // so it stays published and stays one of stable's endpoints.
  assert.ok(
    stable.plugins.updater.endpoints.some((url: string) => url.endsWith('/downloads/latest.json'))
  );
  assert.match(tooling, /LEGACY_MANIFEST_NAME = 'latest\.json'/);
  assert.match(tooling, /files\.set\(LEGACY_MANIFEST_NAME, newestStable\.manifest\)/);

  // And the manifest is self-describing, without breaking readers that predate it.
  assert.match(read('scripts/generate-updater-manifest.cjs'), /schemaVersion: 1/);
});

test('each channel keeps its own identity, endpoints and manifest', () => {
  const channel = read('src/lib/channel.ts');
  const service = read('src/services/appUpdate.ts');

  // The channel picks the file, and stable keeps the URL every pre-0.9 client is
  // compiled with.
  assert.match(channel, /channel === 'stable' \? 'latest\.json'/);
  assert.match(channel, /versionsUrl/);
  assert.match(service, /checkChannelVersion/);
  assert.doesNotMatch(
    service,
    /api\.bitbucket\.org/,
    'the channel-blind repository tag check must be gone'
  );

  const canary = JSON.parse(read('src-tauri/tauri.canary.conf.json'));
  const nightly = JSON.parse(read('src-tauri/tauri.nightly.conf.json'));
  assert.deepEqual(canary.plugins.updater.endpoints, [
    'https://updates.minebench.cloud/canary/latest.json',
    'https://bitbucket.org/minebenchapp/minebench-client/downloads/canary-latest.json',
  ]);
  assert.deepEqual(nightly.plugins.updater.endpoints, [
    'https://updates.minebench.cloud/nightly/latest.json',
    'https://bitbucket.org/minebenchapp/minebench-client/downloads/nightly-latest.json',
  ]);
  assert.match(canary.build.beforeBuildCommand, /build:canary/);
  assert.match(nightly.build.beforeBuildCommand, /build:nightly/);

  // Parallel installation is only safe while the identities differ.
  assert.notEqual(canary.identifier, nightly.identifier);
  assert.notEqual(canary.productName, nightly.productName);
  assert.notEqual(canary.mainBinaryName, nightly.mainBinaryName);
});

test('a nightly build cannot silently keep production endpoints', () => {
  const guard = read('scripts/check-channel-config.mjs');
  const pkg = JSON.parse(read('package.json'));

  assert.match(guard, /must not use production infrastructure/);
  assert.match(guard, /must be given explicit test endpoints/);
  assert.match(pkg.scripts['build:nightly'], /check-channel-config\.mjs nightly/);
  assert.match(pkg.scripts['build:canary'], /check-channel-config\.mjs canary/);
  assert.match(pkg.scripts['build:stable'], /check-channel-config\.mjs stable/);
});

test('a rollback stays inside the pool and a revoked version is never offered', () => {
  const service = read('src/services/appUpdate.ts');
  const rust = read('src-tauri/src/updater.rs');
  const native = read('src-tauri/src/lib.rs');
  const settings = read('src/pages/Settings.tsx');
  const app = read('src/App.tsx');

  // The client reads what the channel offers, and lets the pool bound a rollback.
  assert.match(service, /fetchChannelPool/);
  assert.match(service, /rollbackTargetsFrom/);
  assert.match(service, /invoke<void>\('install_channel_version'/);

  // Enforcement lives in Rust, so an interface cannot talk it out of the rules.
  assert.match(rust, /version_allowed/);
  assert.match(rust, /was revoked/);
  assert.match(rust, /not offered by this channel/);
  assert.match(rust, /version_comparator/);
  assert.match(native, /updater::install_channel_version/);

  // And the user can see both facts: the withdrawal warning and what is offered.
  assert.match(settings, /rollbackTo/);
  assert.match(settings, /was withdrawn by the maintainers/);
  assert.match(app, /RevokedVersionBanner/);
});

test('the installer registers the update source and the client reads it', () => {
  const rust = read('src-tauri/src/update_source.rs');
  const native = read('src-tauri/src/lib.rs');
  const service = read('src/services/appUpdate.ts');
  const stable = JSON.parse(read('src-tauri/tauri.conf.json'));
  const canary = JSON.parse(read('src-tauri/tauri.canary.conf.json'));

  // Each installer writes exactly one registration, for its own channel.
  assert.match(read('src-tauri/resources/installer/write-update-source.ps1'), /-Channel/);
  assert.match(
    read('src-tauri/installer-hooks.canary.nsh'),
    /write-update-source\.ps1.*-Channel canary -Identifier minebench\.canary/
  );
  assert.match(read('src-tauri/linux/postinst-canary.sh'), /CHANNEL=canary/);
  assert.match(read('src-tauri/linux/prerm-canary.sh'), /rm -rf/);

  // The Linux packages are wired per channel, so one package cannot remove or
  // overwrite another channel's registration.
  assert.equal(canary.bundle.linux.deb.postInstallScript, 'linux/postinst-canary.sh');
  assert.notEqual(
    canary.bundle.linux.deb.postInstallScript,
    stable.bundle.linux.deb.postInstallScript
  );
  assert.ok(stable.bundle.resources.includes('resources/installer/**/*'));

  // A registration from another channel, or one this build cannot use, is ignored
  // rather than trusted.
  assert.match(rust, /is_usable/);
  assert.match(rust, /source\.channel == channel/);
  assert.match(native, /update_source::channel_update_source/);
  assert.match(service, /channel_update_source/);
});

test('a kill switch gates old versions at every layer', () => {
  const tooling = read('scripts/channel.mjs');
  const rust = read('src-tauri/src/updater.rs');
  const service = read('src/services/appUpdate.ts');
  const app = read('src/App.tsx');
  const pipeline = read('bitbucket-pipelines.yml');

  // The tooling arms it without touching the pool, so it can be lifted again.
  assert.match(tooling, /applyKillSwitch/);
  assert.match(tooling, /killSwitches/);
  // Rust refuses to install below the gate, so a rollback cannot dodge it.
  assert.match(rust, /kill_switch/);
  assert.match(rust, /is blocked/);
  // The interface stops offering those versions and says why.
  assert.match(service, /killSwitchFrom/);
  assert.match(service, /gated/);
  assert.match(app, /KillSwitchBanner/);
  assert.match(pipeline, /kill-switch:/);
});

test('the channel list is verified the way the updater verifies an artifact', () => {
  const rust = read('src-tauri/src/updater.rs');
  const pipeline = read('bitbucket-pipelines.yml');

  assert.match(rust, /fn pool_trust/);
  // The updater base64-encodes the key and the signature, so decoding them is
  // what makes our verification match the one that guards the artifacts.
  assert.match(rust, /fn base64_to_text/);
  assert.match(rust, /PublicKey::decode/);
  assert.match(rust, /key\.verify\(pool, &signature, true\)/);
  // A published signature that does not hold up stops the install.
  assert.match(rust, /signature check failed/);
  // An unsigned pool is only acceptable while the source is the compiled one.
  assert.match(rust, /fn pool_refusal/);
  assert.match(rust, /not signed, and its update source came from a file/);
  // Signing is switchable, because the client treats an unsigned channel as one
  // that does not sign yet rather than as a broken release.
  assert.match(pipeline, /MINEBENCH_SIGN_MANIFESTS/);
  assert.match(rust, /PoolTrust::Unsigned/);
});

test('the updater can never block the UI on an unresponsive native call', () => {
  const service = read('src/services/appUpdate.ts');

  assert.match(service, /export const withTimeout/);
  assert.match(service, /AbortSignal\.timeout\(CHECK_TIMEOUT_MS\)/);
  assert.match(service, /if \(installPromise\) return installPromise;/);
  assert.match(service, /RELAUNCH_TIMEOUT_MS/);
});
