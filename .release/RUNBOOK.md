# Release runbook

Every command below is the one the pipeline runs, so a release can be reproduced
by hand. Channel rules live in `.release/README.md`.

`bitbucket-pipelines.yml` in this repository root is the only pipeline that
matters. Copies under `.codex/` or `.release-worktrees/` are staging leftovers
from before the channels existed (cloud runners, cross-compiled Windows, a single
manifest) — never push one of those over it.

## Roles

| Step | Who |
| --- | --- |
| nightly (every merge to `main`) | nobody: the pipeline publishes it |
| canary (tag `vX.Y.Z-canary.N`) | one approval from the release engineer |
| stable (tag `vX.Y.Z`) | release engineer plus a written QA sign-off |
| revocation, kill switch | administrator only, with a reason in the command |

## Routine releases

```sh
# nightly: merge to main, nothing else to do
git push origin main

# canary / stable: tag the commit you want promoted
git tag v0.9.0-canary.1 && git push origin v0.9.0-canary.1
git tag v0.9.0          && git push origin v0.9.0
```

The pipeline resolves the channel from the ref (`channel.mjs resolve-build`),
builds both platforms, generates the SBOM and the manifest, publishes, verifies
what it published, and records the new channel state on `main` with `[skip ci]`.

## Withdrawing what was published

```sh
# a version must never be installable again
#   custom pipeline: revoke      (MINEBENCH_CHANNEL, MINEBENCH_VERSION, REVOKE_REASON)

# stop versions below a version, but keep them in the pool so it can be lifted
#   custom pipeline: kill-switch (MINEBENCH_CHANNEL, MIN_VERSION,
#                                 MINEBENCH_KILL_MESSAGE, MINEBENCH_KILL_BLOCK)

# lifting the gate: the same pipeline with MIN_VERSION empty
```

Both run `channel.mjs` and then `scripts/publish-artifacts.sh`, which uploads the
new pointers, deletes what left the pool, re-downloads everything it uploaded and
compares it, and commits the state.

## Quality control before canary and stable

Run these on a machine that has one channel installed, then a second one:

1. **Channel isolation** — install stable and canary side by side: separate
   install directories, separate `%APPDATA%\<identifier>` / `~/.config/<identifier>`,
   separate shortcuts, separate scheduled tasks, separate autostart entries.
2. **No simultaneous run** — start the second channel while the first runs: the
   prompt appears, "close it and continue" stops the first one through its normal
   shutdown (the miner is stopped), and this instance continues.
3. **Upgrade** — from N-2 and N-1 to N, per channel, with the version check
   passing and the client restarting into the new build.
4. **Old client compatibility** — a client built before the permanent entry point
   still finds `latest.json` on the download area.
5. **Update-source migration** — reinstall the same channel with a different
   `downloadsBase`: the registration is replaced, not duplicated, and other
   channels' registrations are untouched.
6. **Rollback** — roll back to an older version inside the pool; a version that is
   revoked or below an armed kill switch is refused with its reason.
7. **Withdrawal** — revoke a version, then confirm it is gone from the pool file,
   from the download area, and refused by the client.
8. **Integrity** — every `.sig` is present, `latest.json` verifies against the
   compiled key, and `sbom-<version>.json` is published.

## Incidents

| Situation | Action |
| --- | --- |
| A released version misbehaves | `revoke` it, then publish a hotfix |
| A stable release must be corrected | tag `vX.Y.(Z+1)` from the fixed commit; canary, nightly and the pools are untouched |
| Something is wrong but only for some machines | arm the kill switch with `block=false`; escalate to a revocation if it spreads |
| Nothing may run at all | arm the kill switch with `block=true` and a message that says what to do |

Emergency revocation is a custom pipeline run, so it does not wait for a build.
It takes effect no later than the next client check, and the downloads area is
cleaned in the same run.

## Supply chain

* Signing keys live in Bitbucket secured variables: `TAURI_SIGNING_PRIVATE_KEY`
  signs the updater artifacts, `BITBUCKET_RELEASE_TOKEN` is the repository write
  token used for the download area and the state commit.
* **Manifest signatures.** The channel files (`*-latest.json`,
  `*-versions.json`, `*-revoked.json`) can be signed with the same key by setting
  `MINEBENCH_SIGN_MANIFESTS=1`. The client fetches `<file>.sig` and refuses a
  channel whose signature does not verify; an unsigned channel is treated as one
  that does not sign yet, so turning the switch on cannot break an older client,
  and turning it off cannot break a rollout. Enable it once the signing command
  has been confirmed on the runner, then check that a rollback still works.
* **Rotation.** The updater verifies artifacts against the public key compiled
  into the client, so rotation is a two-step release: (1) ship a release, signed
  with the current key, whose build embeds the *new* public key; (2) from then on
  sign with the new key. Clients that skip the transition release cannot be
  reached by the new key and have to be reinstalled, so keep the window long.
  Verify once per rotation that the old key still validates the transition
  release.
* SBOM: `sbom-<version>.json` is published next to every release, built from
  `package-lock.json` and `cargo metadata` so it describes exactly what the lock
  files pin.
* Every published file is re-downloaded and byte-compared by
  `scripts/publish-artifacts.sh` before the run is considered successful.

## Accepted risks

* **The privileged sensor task runs a binary that the installing user can write.**
  The Windows install is per-user, so `minebench-sensor-broker.exe` lives in a
  directory its own user can modify, and the task that runs it is registered with
  highest privileges. A process running as that user can therefore replace the
  broker and reach high integrity without a prompt. The broker path is passed
  explicitly instead of being discovered, the broker refuses to write its snapshot
  through a reparse point (checked before and after creating the directory, and the
  temporary file is created exclusively so it is never created through a link), and
  the same writer could equally replace any file in that installation. The
  elevation path itself cannot be closed without one of: signing the broker and
  verifying its publisher before the task runs, or installing machine-wide
  (`bundle.windows.nsis.installMode: "perMachine"`, which needs a migration path for
  existing per-user installs). Both were out of scope for this change.
* **The elevated broker loads PawnIO driver modules from the installation
  directory**, and `MINEBENCH_PAWNIO_MODULES` overrides that search. Those modules
  are executed by the WHQL-signed driver in kernel mode, so the blast radius is
  larger than the high-integrity process above: an attacker who can write to that
  directory, or register the task with the override, is beyond what this document
  can bound. Treat any change to the module directory or the override as a release
  blocker of its own.
* **A payout destination can be changed by any authenticated session.** See the
  authorisation note in `iam.service.updateXmrWallet`: the field is validated, not
  entitlement-gated, by design. The validation lives in the backend, so this
  release depends on that check shipping.

## Before the first real release

* Self-hosted runners on Windows and Linux, labelled `windows` and `linux.shell`.
* Secured variables: `TAURI_SIGNING_PRIVATE_KEY`, `BITBUCKET_RELEASE_TOKEN`
  (repository write).
* The redirect for `https://updates.minebench.cloud/<channel>/latest.json`.
* macOS is not built: there is no Mac runner and no Developer ID, so those
  channels have no macOS artifacts at all.
* Linux `.deb`/`.rpm` install from the download area; there is no APT/DNF
  repository (Bitbucket cannot host one), so in-app updates cover the AppImage.
