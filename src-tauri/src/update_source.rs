//! Where this installation gets its updates from.
//!
//! The installer registers the source for its channel, so the update location is
//! not only baked into the binary: shipping a new installer or package repoints an
//! installed client when the infrastructure moves. A reinstall overwrites the one
//! file the channel owns, so stale entries cannot accumulate.
//!
//! Per platform: the Windows NSIS hook writes `update-source.json` into the
//! channel's own application data directory (`%APPDATA%\<identifier>`, already
//! isolated by identifier); the Linux `.deb`/`.rpm` maintainer scripts write
//! `/etc/minebench/<channel>/update-source.json`, which only root can write, and
//! remove exactly that file when the package goes.
//!
//! A file written for another channel is ignored, and a file this build cannot
//! use is ignored as well, so a corrupt registration can never break updating.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Bumped only when the meaning of the file changes.
pub const SCHEMA_VERSION: u32 = 1;

/// What a build falls back to when no installer registered a source.
pub const DEFAULT_DOWNLOADS_BASE: &str =
    "https://bitbucket.org/minebenchapp/minebench-client/downloads/";

/// Permanent entry point of every channel, so installed clients keep updating
/// when the files move. It is expected to redirect to the current location, and
/// the build also lists the current location as a fallback, so a channel whose
/// entry point is not configured yet still updates.
pub const DEFAULT_BOOTSTRAP_BASE: &str = "https://updates.minebench.cloud/";

const FILE_NAME: &str = "update-source.json";

/// System-wide location, for managed deployments.
#[cfg(not(target_os = "windows"))]
const SYSTEM_DIR: &str = "/etc/minebench";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSource {
    pub schema_version: u32,
    pub channel: String,
    pub downloads_base: String,
    /// Permanent entry point, when the installation is configured with one.
    #[serde(default)]
    pub bootstrap_base: String,
}

impl UpdateSource {
    /// What this build carries, used until an installer registers a source.
    pub fn compiled(channel: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            channel: channel.to_string(),
            downloads_base: DEFAULT_DOWNLOADS_BASE.to_string(),
            bootstrap_base: DEFAULT_BOOTSTRAP_BASE.to_string(),
        }
    }

    /// A registration is used only when this build understands it.
    pub fn is_usable(&self) -> bool {
        self.schema_version <= SCHEMA_VERSION
            && matches!(self.channel.as_str(), "stable" | "canary" | "nightly")
            && is_https_base(&self.downloads_base)
            && (self.bootstrap_base.is_empty() || is_https_base(&self.bootstrap_base))
    }

    /// The forward endpoints, in the order the updater tries them.
    ///
    /// The permanent entry point comes first and the current location second:
    /// the updater moves on to the next URL when one fails, so a channel whose
    /// entry point does not exist yet works unchanged, and needs no rebuild once
    /// it does.
    pub fn manifest_endpoints(&self) -> Vec<String> {
        let mut endpoints = Vec::new();
        if is_https_base(&self.bootstrap_base) {
            endpoints.push(format!("{}{}/latest.json", self.bootstrap_base, self.channel));
        }
        endpoints.push(self.manifest_url());
        endpoints
    }

    /// The manifest every client of the channel follows.
    ///
    /// `stable` keeps the unprefixed file, because that is the URL every pre-0.9
    /// client is compiled with and it must keep working.
    pub fn manifest_url(&self) -> String {
        if self.channel == "stable" {
            format!("{}latest.json", self.downloads_base)
        } else {
            format!("{}{}-latest.json", self.downloads_base, self.channel)
        }
    }

    /// The version pool: what may be installed, and what may be rolled back to.
    /// It also carries the revoked list, so the channel needs no second file.
    pub fn pool_url(&self) -> String {
        format!("{}{}-versions.json", self.downloads_base, self.channel)
    }

    /// The manifest of one version, which is what a rollback installs.
    pub fn manifest_url_for(&self, version: &str) -> String {
        format!(
            "{}manifest-{}-{}.json",
            self.downloads_base, self.channel, version
        )
    }
}

/// A base URL this build is willing to fetch from: https, absolute, a directory.
fn is_https_base(value: &str) -> bool {
    value.starts_with("https://") && value.ends_with('/') && value.len() > "https://".len() + 1
}

/// Files an installer may have written, most specific first.
///
/// Windows only consults the installation's own directory, inside the user's
/// profile. A machine-wide registration is deliberately not read there: the shared
/// location allows any interactive user to create entries, so one user could
/// redirect another user's updates with a file that looks legitimate. On Linux the
/// machine-wide registration lives under `/etc`, which only root — that is, the
/// package manager — can write.
pub fn candidate_paths(
    app: &AppHandle,
    #[cfg_attr(target_os = "windows", allow(unused_variables))] channel: &str,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(directory) = app.path().app_config_dir() {
        paths.push(directory.join(FILE_NAME));
    }

    #[cfg(not(target_os = "windows"))]
    paths.push(PathBuf::from(SYSTEM_DIR).join(channel).join(FILE_NAME));

    paths
}

/// Reads a registration, rejecting one this build cannot use or that belongs to
/// another channel.
pub fn read_from(path: &Path, channel: &str) -> Option<UpdateSource> {
    let body = std::fs::read(path).ok()?;
    let source: UpdateSource = serde_json::from_slice(&body).ok()?;
    (source.channel == channel && source.is_usable()).then_some(source)
}

/// The source this installation updates from, and whether a file registered it.
///
/// A registered source is the one case where the pool cannot be taken on trust
/// without a signature, so the caller has to know which one it got.
pub fn resolve(app: &AppHandle, channel: &str) -> (UpdateSource, bool) {
    for path in candidate_paths(app, channel) {
        if let Some(source) = read_from(&path, channel) {
            return (source, true);
        }
    }
    (UpdateSource::compiled(channel), false)
}

/// The resolved source and the URLs derived from it, so the interface reads the
/// same place the native side does instead of building URLs of its own.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSource {
    pub channel: String,
    pub downloads_base: String,
    pub manifest_url: String,
    pub pool_url: String,
    /// The forward endpoints in the order this installation will try them, so
    /// diagnostics can show which addresses a client depends on.
    pub manifest_endpoints: Vec<String>,
}

/// The resolved source of this installation.
#[tauri::command]
pub fn channel_update_source(app: AppHandle) -> ResolvedSource {
    let channel = crate::updater::channel_from_identifier(&app.config().identifier);
    let (source, _) = resolve(&app, channel);

    ResolvedSource {
        channel: source.channel.clone(),
        downloads_base: source.downloads_base.clone(),
        manifest_url: source.manifest_url(),
        pool_url: source.pool_url(),
        manifest_endpoints: source.manifest_endpoints(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(channel: &str, base: &str) -> String {
        format!(
            r#"{{"schemaVersion":1,"channel":"{channel}","downloadsBase":"{base}"}}"#
        )
    }

    fn temp_file(name: &str, contents: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "minebench-update-source-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("create temp directory");
        let path = directory.join(FILE_NAME);
        std::fs::write(&path, contents).expect("write registration");
        path
    }

    #[test]
    fn urls_follow_the_channel_and_keep_the_legacy_stable_manifest() {
        let stable = UpdateSource::compiled("stable");
        assert_eq!(
            stable.manifest_url(),
            "https://bitbucket.org/minebenchapp/minebench-client/downloads/latest.json"
        );

        let canary = UpdateSource::compiled("canary");
        assert_eq!(
            canary.manifest_url(),
            "https://bitbucket.org/minebenchapp/minebench-client/downloads/canary-latest.json"
        );
        assert_eq!(
            canary.pool_url(),
            "https://bitbucket.org/minebenchapp/minebench-client/downloads/canary-versions.json"
        );
        assert_eq!(
            canary.manifest_url_for("0.9.0-canary.3"),
            "https://bitbucket.org/minebenchapp/minebench-client/downloads/manifest-canary-0.9.0-canary.3.json"
        );
    }

    #[test]
    fn forward_endpoints_put_the_permanent_address_first() {
        let compiled = UpdateSource::compiled("canary");
        assert_eq!(
            compiled.manifest_endpoints(),
            vec![
                "https://updates.minebench.cloud/canary/latest.json".to_string(),
                "https://bitbucket.org/minebenchapp/minebench-client/downloads/canary-latest.json"
                    .to_string(),
            ]
        );

        // An installation registered without an entry point still updates from
        // wherever the files are.
        let mut without_bootstrap = compiled.clone();
        without_bootstrap.bootstrap_base = String::new();
        assert_eq!(
            without_bootstrap.manifest_endpoints(),
            vec![
                "https://bitbucket.org/minebenchapp/minebench-client/downloads/canary-latest.json"
                    .to_string()
            ]
        );

        // An entry point that is not https is ignored, not used and not fatal.
        let mut insecure = compiled.clone();
        insecure.bootstrap_base = "http://updates.minebench.cloud/".to_string();
        assert_eq!(insecure.manifest_endpoints().len(), 1);

        // Stable keeps the unprefixed manifest name every pre-0.9 client has.
        assert!(UpdateSource::compiled("stable").manifest_endpoints()[1].ends_with("/latest.json"));
    }

    #[test]
    fn only_registrations_this_build_understands_are_usable() {
        assert!(UpdateSource::compiled("stable").is_usable());

        let mut insecure = UpdateSource::compiled("stable");
        insecure.downloads_base = "http://example.test/downloads/".to_string();
        assert!(!insecure.is_usable(), "plain http must be refused");

        let mut unfinished = UpdateSource::compiled("stable");
        unfinished.downloads_base = "https://example.test/downloads".to_string();
        assert!(!unfinished.is_usable(), "a base must end with a slash");

        let mut unknown_channel = UpdateSource::compiled("stable");
        unknown_channel.channel = "beta".to_string();
        assert!(!unknown_channel.is_usable());

        let mut newer_schema = UpdateSource::compiled("stable");
        newer_schema.schema_version = SCHEMA_VERSION + 1;
        assert!(!newer_schema.is_usable(), "a newer schema must not be guessed at");
    }

    #[test]
    fn a_registration_written_by_another_channel_is_ignored() {
        let canary_file = temp_file("canary", &registration("canary", DEFAULT_DOWNLOADS_BASE));

        assert!(read_from(&canary_file, "canary").is_some());
        assert!(
            read_from(&canary_file, "stable").is_none(),
            "a canary registration must not redirect stable"
        );
    }

    #[test]
    fn an_unusable_registration_falls_back_to_the_compiled_default() {
        let insecure = temp_file(
            "insecure",
            &registration("stable", "http://mirror.example.test/downloads/"),
        );
        assert!(read_from(&insecure, "stable").is_none());
        assert_eq!(
            UpdateSource::compiled("stable").downloads_base,
            DEFAULT_DOWNLOADS_BASE
        );

        let malformed = temp_file("malformed", "{ not json");
        assert!(read_from(&malformed, "stable").is_none());
        assert!(read_from(&insecure.join("missing.json"), "stable").is_none());
    }
}
