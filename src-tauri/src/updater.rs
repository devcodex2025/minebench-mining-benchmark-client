//! Channel-aware updates.
//!
//! Rolling back means installing a version that is *not* newer, which the
//! updater refuses by default and which the release tooling deliberately limits
//! to the channel's version pool. Two rules follow, and both are enforced here
//! rather than in the interface:
//!
//! * only a version listed in `{channel}-versions.json` may be installed;
//! * a revoked version may never be installed, whatever the interface asks for.
//!
//! Forward updates keep going through the plugin's ordinary check, which only
//! ever follows the channel's `*-latest.json`.

use std::time::Duration;

use serde::Deserialize;
use semver::Version;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::UpdaterExt;

use crate::update_source::{resolve, UpdateSource};

const POOL_TIMEOUT: Duration = Duration::from_secs(15);

/// Delivery channel this build belongs to, taken from its bundle identifier.
///
/// `minebench.client` -> stable, `minebench.canary` -> canary,
/// `minebench.nightly` -> nightly, anything unexpected -> stable.
pub fn channel_from_identifier(identifier: &str) -> &'static str {
    match identifier.rsplit('.').next() {
        Some("canary") => "canary",
        Some("nightly") => "nightly",
        _ => "stable",
    }
}

#[derive(Debug, Deserialize)]
pub struct PoolVersion {
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokedVersion {
    pub version: String,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Stops versions below `minVersion` from being installed or run.
///
/// Unlike a revocation it is temporary: clearing it re-enables those versions, so
/// the tooling keeps them in the pool and this gate decides. Only the minimum is
/// modelled here вЂ” whether the interface warns or blocks is presentation, and the
/// interface reads it from the same file.
#[derive(Debug, Deserialize)]
pub struct KillSwitch {
    #[serde(rename = "minVersion")]
    pub min_version: String,
    #[serde(default)]
    pub message: Option<String>,
}

/// `{channel}-versions.json`, the authority on what a channel offers.
#[derive(Debug, Default, Deserialize)]
pub struct ChannelPool {
    #[serde(default)]
    pub versions: Vec<PoolVersion>,
    #[serde(default)]
    pub revoked: Vec<RevokedVersion>,
    #[serde(default, rename = "killSwitch")]
    pub kill_switch: Option<KillSwitch>,
}

/// A version may be installed only while it is in the channel pool, is not
/// revoked, and is not held back by an armed kill switch.
pub fn version_allowed(pool: &ChannelPool, version: &str) -> Result<(), String> {
    if let Some(entry) = pool.revoked.iter().find(|entry| entry.version == version) {
        let reason = entry.reason.as_deref().unwrap_or("no reason recorded");
        return Err(format!("version {version} was revoked ({reason})"));
    }

    if let Some(kill_switch) = &pool.kill_switch {
        // A gate nobody can parse blocks nothing, rather than everything: the
        // tooling validates it, so an unreadable value means corruption, and
        // bricking every install because of it would be worse than ignoring it.
        if let (Ok(minimum), Ok(candidate)) = (
            Version::parse(&kill_switch.min_version),
            Version::parse(version),
        ) {
            if candidate < minimum {
                let message = kill_switch
                    .message
                    .as_deref()
                    .unwrap_or("this version must not run any more");
                return Err(format!("version {version} is blocked ({message})"));
            }
        }
    }

    if !pool.versions.iter().any(|entry| entry.version == version) {
        return Err(format!(
            "version {version} is not offered by this channel any more"
        ));
    }
    Ok(())
}

/// How much the channel's own file can be trusted.
#[derive(Debug, PartialEq, Eq)]
pub enum PoolTrust {
    /// No signature is published: the channel does not sign its list yet.
    Unsigned,
    /// The signature matches the key this build was compiled with.
    Verified,
    /// A signature is published and does not hold up. Never acted on.
    Invalid(String),
}

/// Decodes the base64 envelope the Tauri signer wraps around keys and signatures.
///
/// The updater stores both that way, so the same key file and the same `.sig`
/// format cover the artifacts and our own channel files.
fn base64_to_text(value: &str) -> Result<String, String> {
    use base64::Engine;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|error| format!("not valid base64: {error}"))?;

    String::from_utf8(decoded).map_err(|_| "the decoded content is not text".to_string())
}

/// A channel is acted on unless a signature is present and does not verify.
///
/// An unsigned channel is simply one that does not publish signatures yet, so
/// demanding one would turn a missing feature into a broken release. A signature
/// that is present but wrong means something else entirely: the file changed
/// after it was signed, so it is refused rather than ignored.
pub fn pool_trust(pool: &[u8], signature: Option<&str>, pubkey: &str) -> PoolTrust {
    let Some(signature) = signature else {
        return PoolTrust::Unsigned;
    };

    let key = match base64_to_text(pubkey).and_then(|text| {
        minisign_verify::PublicKey::decode(&text).map_err(|error| error.to_string())
    }) {
        Ok(key) => key,
        Err(reason) => return PoolTrust::Invalid(format!("the compiled key is unreadable: {reason}")),
    };

    let signature = match base64_to_text(signature).and_then(|text| {
        minisign_verify::Signature::decode(&text).map_err(|error| error.to_string())
    }) {
        Ok(signature) => signature,
        Err(reason) => return PoolTrust::Invalid(format!("the signature is malformed: {reason}")),
    };

    // `allow_legacy` matches the updater, which accepts both signature formats.
    match key.verify(pool, &signature, true) {
        Ok(()) => PoolTrust::Verified,
        Err(error) => PoolTrust::Invalid(format!("the signature does not match: {error}")),
    }
}

/// The reason a pool must not be acted on, if there is one.
///
/// An unsigned pool is normal for a channel that does not publish signatures yet,
/// but only while the source is the one compiled into the build. Once a file
/// decides where updates come from, an unsigned pool would let whoever could place
/// that file choose what may be installed, so it is refused.
pub fn pool_refusal(trust: &PoolTrust, registered: bool) -> Option<String> {
    match trust {
        PoolTrust::Verified => None,
        PoolTrust::Invalid(reason) => Some(format!("its signature check failed ({reason})")),
        PoolTrust::Unsigned if registered => {
            Some("it is not signed, and its update source came from a file".to_string())
        }
        PoolTrust::Unsigned => None,
    }
}

/// The public key the build compiled in, so our own verification uses the same
/// key that signs the release artifacts.
fn compiled_pubkey(app: &AppHandle) -> Option<String> {
    let raw = app.config().plugins.0.get("updater")?.clone();
    let config: tauri_plugin_updater::Config = serde_json::from_value(raw).ok()?;
    Some(config.pubkey)
}

pub async fn fetch_pool(
    source: &UpdateSource,
    pubkey: &str,
) -> Result<(ChannelPool, PoolTrust), String> {
    let client = reqwest::Client::builder()
        .timeout(POOL_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(source.pool_url())
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "the {} channel list answered with {}",
            source.channel,
            response.status()
        ));
    }
    let body = response.bytes().await.map_err(|error| error.to_string())?;

    // Fetching the signature is best effort: a channel that publishes none is not
    // an error, it is a channel that does not sign yet.
    let signature = match client
        .get(format!("{}.sig", source.pool_url()))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response.text().await.ok(),
        _ => None,
    };

    let trust = pool_trust(&body, signature.as_deref(), pubkey);
    let pool = serde_json::from_slice::<ChannelPool>(&body).map_err(|error| error.to_string())?;
    Ok((pool, trust))
}

/// Installs one version from this channel's pool, replacing the running one.
///
/// Used for rollback only; a forward update goes through the plugin's own check.
#[tauri::command]
pub async fn install_channel_version(app: AppHandle, version: String) -> Result<(), String> {
    let channel = channel_from_identifier(&app.config().identifier);
    // The installer registered where this installation updates from; a moved
    // repository is therefore picked up by reinstalling, not by rebuilding.
    let (source, registered) = resolve(&app, channel);
    let (pool, trust) = fetch_pool(&source, &compiled_pubkey(&app).unwrap_or_default()).await?;
    if let Some(reason) = pool_refusal(&trust, registered) {
        return Err(format!("the {channel} channel list was refused: {reason}"));
    }
    version_allowed(&pool, &version)?;

    let endpoint = Url::parse(&source.manifest_url_for(&version)).map_err(|error| error.to_string())?;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        // The default comparator only accepts a newer version, which a rollback
        // never is; anything different from the running one is installable, and
        // the pool check above is what bounds it.
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("version {version} has no artifact for this platform"))?;

    // The plugin verifies the manifest signature against the compiled public key
    // before anything is written.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    // On Windows the installer takes over and restarts the app; elsewhere the
    // running process has to hand over itself.
    #[cfg(not(target_os = "windows"))]
    app.restart();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool(versions: &[&str], revoked: &[(&str, Option<&str>)]) -> ChannelPool {
        ChannelPool {
            versions: versions
                .iter()
                .map(|version| PoolVersion {
                    version: (*version).to_string(),
                })
                .collect(),
            revoked: revoked
                .iter()
                .map(|(version, reason)| RevokedVersion {
                    version: (*version).to_string(),
                    reason: reason.map(str::to_string),
                })
                .collect(),
            kill_switch: None,
        }
    }

    fn gated(versions: &[&str], min_version: &str) -> ChannelPool {
        ChannelPool {
            kill_switch: Some(KillSwitch {
                min_version: min_version.to_string(),
                message: Some("payout regression".to_string()),
            }),
            ..pool(versions, &[])
        }
    }

    #[test]
    fn the_identifier_names_the_channel() {
        assert_eq!(channel_from_identifier("minebench.client"), "stable");
        assert_eq!(channel_from_identifier("minebench.canary"), "canary");
        assert_eq!(channel_from_identifier("minebench.nightly"), "nightly");
        // A pre-0.9 identifier, or anything unexpected, is the stable channel.
        assert_eq!(channel_from_identifier("cloud.minebench.client"), "stable");
        assert_eq!(channel_from_identifier(""), "stable");
    }

    /// The public key the build ships with, base64-encoded exactly as the updater
    /// stores it, so a failure here also catches a broken configuration.
    fn compiled_key() -> String {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("config parses");
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("the updater public key is configured")
            .to_string()
    }

    #[test]
    fn a_channel_is_refused_only_when_its_signature_does_not_hold_up() {
        let pool = br#"{"versions":[],"revoked":[]}"#;
        let key = compiled_key();

        // No signature: the channel simply does not sign yet.
        assert_eq!(pool_trust(pool, None, &key), PoolTrust::Unsigned);

        // Something that is not a signature at all.
        match pool_trust(pool, Some("not a signature"), &key) {
            PoolTrust::Invalid(reason) => assert!(reason.contains("malformed"), "{reason}"),
            other => panic!("expected a malformed signature to be refused, got {other:?}"),
        }

        // Valid base64 that is still not a signature.
        use base64::Engine;
        let junk = base64::engine::general_purpose::STANDARD.encode("hello");
        match pool_trust(pool, Some(&junk), &key) {
            PoolTrust::Invalid(reason) => assert!(reason.contains("malformed"), "{reason}"),
            other => panic!("expected junk to be refused, got {other:?}"),
        }

        // An unreadable key must not be read as "everything is fine".
        match pool_trust(pool, Some(&junk), "") {
            PoolTrust::Invalid(reason) => assert!(reason.contains("unreadable"), "{reason}"),
            other => panic!("expected an unreadable key to be refused, got {other:?}"),
        }
    }

    #[test]
    fn only_a_registered_source_needs_a_signature() {
        // Compiled-in source, no signature: the channel simply does not sign yet.
        assert_eq!(pool_refusal(&PoolTrust::Unsigned, false), None);
        assert_eq!(pool_refusal(&PoolTrust::Verified, true), None);

        // A file decided where updates come from, so its pool must be signed.
        let refusal =
            pool_refusal(&PoolTrust::Unsigned, true).expect("a registered source needs a signature");
        assert!(refusal.contains("not signed"), "{refusal}");

        let broken =
            pool_refusal(&PoolTrust::Invalid("bad base64".to_string()), false).expect("refused");
        assert!(broken.contains("signature check failed"), "{broken}");
    }

    #[test]
    fn the_compiled_key_is_readable_by_the_verifier() {
        // The updater base64-encodes the key file, so decoding it first is what
        // makes our verification match the updater's.
        let text = base64_to_text(&compiled_key()).expect("the key decodes");
        assert!(text.starts_with("untrusted comment:"), "{text}");
        assert!(
            minisign_verify::PublicKey::decode(&text).is_ok(),
            "the compiled public key must be readable by the verifier"
        );
    }

    #[test]
    fn only_pooled_versions_may_be_installed() {
        let channel_pool = pool(&["0.9.0", "0.8.49"], &[]);
        assert!(version_allowed(&channel_pool, "0.8.49").is_ok());
        assert_eq!(
            version_allowed(&channel_pool, "0.8.47").unwrap_err(),
            "version 0.8.47 is not offered by this channel any more"
        );
    }

    #[test]
    fn a_kill_switch_blocks_installing_anything_below_it() {
        let gated_pool = gated(&["0.9.0", "0.8.49"], "0.9.0");

        assert!(version_allowed(&gated_pool, "0.9.0").is_ok());
        let error = version_allowed(&gated_pool, "0.8.49").unwrap_err();
        assert!(error.contains("blocked"), "{error}");
        assert!(error.contains("payout regression"), "{error}");

        // An unreadable gate blocks nothing, so corruption cannot brick installs.
        let malformed = gated(&["0.9.0", "0.8.49"], "not a version");
        assert!(version_allowed(&malformed, "0.8.49").is_ok());
    }

    #[test]
    fn a_revoked_version_can_never_be_installed() {
        let channel_pool = pool(&["0.9.0"], &[("0.8.49", Some("payout regression"))]);
        let error = version_allowed(&channel_pool, "0.8.49").unwrap_err();
        assert!(error.contains("was revoked"), "{error}");
        assert!(error.contains("payout regression"), "{error}");

        // Revoked versions are not listed as installable either.
        let also_listed = pool(&["0.9.0", "0.8.49"], &[("0.8.49", None)]);
        assert!(version_allowed(&also_listed, "0.8.49").is_err());
    }
}
