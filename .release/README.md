# Release channels

`channels.json` is the single source of truth for what each delivery channel
offers. It is versioned on purpose: every pool change and every revocation is a
commit, which is also the audit trail (who, when, why).

Managed by `scripts/channel.mjs` — never edit the pools by hand.

## Pools

| Channel | Rule | Size |
| --- | --- | --- |
| `nightly` | newest build from `main` only | 1 |
| `canary` | every version strictly newer than the newest `stable` (SemVer 2.0.0) | unbounded |
| `stable` | newest versions | 3 |

A version that is not in a pool is revoked by definition. `revoked` additionally
records explicit revocations, which stay listed so the client can explain why a
version it is running is no longer offered.

## Version formats

```
0.9.0-nightly.20261012.1   nightly
0.9.0-canary.3             canary
0.9.0                      stable
```

`publish` refuses a version whose shape does not match the target channel, so a
release candidate can never land in `stable` and a stable version can never land
in `canary`.

## Pipeline

```sh
node scripts/channel.mjs publish --channel canary --version 0.9.0-canary.3 \
  --manifest release-artifacts/canary-0.9.0-canary.3.json --out release-artifacts

node scripts/channel.mjs revoke --version 0.9.0-canary.2 --channel canary \
  --reason "miner crash on Ryzen 5000" --by admin --out release-artifacts
```

Both print `{ "written": [...], "delete": [...], "removedLocally": [...] }`. `delete`
names the files the pipeline must remove from Bitbucket Downloads, so a version
that leaves a pool — pruned or revoked — cannot be installed any more. They also
drop those files from `--out` and delete a channel's `-latest.json` once its pool
is empty, so uploading the whole output directory can never resurrect a version
that left a pool.

`render` rebuilds the pointer files from the current state without changing it.

## Pipeline

`bitbucket-pipelines.yml` derives `CHANNEL` and `VERSION` from the ref, so one
set of steps serves every channel:

```sh
eval "$(node scripts/channel.mjs resolve-build)"   # main -> nightly, v* -> canary/stable
```

`publish` and `revoke` also accept `--report <path>`, which
`scripts/publish-artifacts.sh` reads to upload, remove, verify and then commit the
new `channels.json` back to `main` with `[skip ci]`.

## Update source

Every installer registers where its channel gets updates from, so a moved
repository reaches installed clients by reinstalling or upgrading:

| Platform | Written by | Location |
| --- | --- | --- |
| Windows | NSIS hook | `%APPDATA%\<identifier>\update-source.json` |
| Linux (`.deb`/`.rpm`) | maintainer scripts | `/etc/minebench/<channel>/update-source.json` |

On Linux the packages also register a machine-wide file under `/etc/minebench`
that only root, that is the package manager, can write; it is consulted only when
the installation's own file is missing or unusable. Windows has no equivalent that
can be trusted: the shared location allows any user to create entries, so nothing
machine-wide is read there at all.

The client takes the first usable file belonging to its channel and otherwise falls
back to the source compiled into the build, so a corrupt or foreign registration
cannot break updating. One file per channel is the whole mechanism: upgrading
replaces it, and nothing has to be cleaned up to avoid duplicates.

The forward update still follows the endpoint compiled into the build, because
the Tauri updater reads its endpoints from the build configuration only. That is
why the compiled endpoint has to stay a permanent address for the channel rather
than a pointer to wherever the files happen to live today.

## Permanent entry point

`https://updates.minebench.cloud/<channel>/latest.json` is the address clients are
compiled with from this release on. It is expected to redirect to wherever the
files are, so the infrastructure can move without rebuilding or reinstalling
anyone.

The build lists the current location right after it, and the updater moves on to
the next endpoint when one fails. A channel whose entry point does not exist yet
therefore falls through to the working address, and needs no rebuild once the
entry point goes live.

Clients installed before this change are compiled with the download-area URL
itself, so that URL keeps working and every stable release republishes
`latest.json` there.

Update manifests carry `schemaVersion`, which the updater ignores. Our own files
(`*-versions.json`, `*-revoked.json`) are read forward-compatibly: unknown fields
are ignored and a registration claiming a newer schema version is refused rather
than guessed at.
