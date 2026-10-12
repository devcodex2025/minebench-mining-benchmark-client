#!/usr/bin/env bash
#
# Publishes what a channel command produced, removes the files that left a
# pool, verifies the download area, and records the new channel state.
#
# Shared by the release pipeline and the manual revoke pipeline, so both paths
# cannot drift apart.
#
# Inputs (environment):
#   BITBUCKET_RELEASE_TOKEN  repository write token (upload, delete, git push)
#   CHANNEL, VERSION         resolved by `channel.mjs resolve-build`
#   REPORT                   report written by `channel.mjs publish|revoke`
#                            (default: build/publish.json)
#   ARTIFACTS_DIR            directory holding the files to upload
#                            (default: release-artifacts)
#   BITBUCKET_WORKSPACE / BITBUCKET_REPO_SLUG / BITBUCKET_COMMIT
#
set -euo pipefail

artifacts_dir=${ARTIFACTS_DIR:-release-artifacts}
report=${REPORT:-build/publish.json}
workspace=${BITBUCKET_WORKSPACE:-minebenchapp}
repo=${BITBUCKET_REPO_SLUG:-minebench-client}
downloads="https://bitbucket.org/$workspace/$repo/downloads"
api="https://api.bitbucket.org/2.0/repositories/$workspace/$repo/downloads"

: "${BITBUCKET_RELEASE_TOKEN:?SET_ON_DEPLOY}"
: "${CHANNEL:?CHANNEL is required}"
: "${VERSION:?VERSION is required}"
test -f "$report" || { echo "publish-artifacts: $report is missing" >&2; exit 1; }

# One name per line, straight from the report the channel tooling wrote.
list() {
  node -e '
    const fs = require("fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write((report[process.argv[2]] ?? []).join("\n"));
  ' "$report" "$1"
}

uploaded=$(list publish)
doomed=$(list delete)
test -n "$uploaded" || { echo "publish-artifacts: nothing to upload" >&2; exit 1; }

# Anything versioned must belong to the version this run resolved, so a stale
# artifact left over from an earlier run can never be published by accident. Only
# the artifacts are checked: the manifests and pointer files are rendered from the
# channel state, which is keyed by version, so they cannot be stale.
for name in $uploaded; do
  case "$name" in
    mbc-*)
      if ! printf '%s' "$name" | grep -qF "$VERSION"; then
        echo "publish-artifacts: refusing to publish $name, it is not from $VERSION" >&2
        exit 1
      fi
      ;;
  esac
done

echo "Publishing $CHANNEL $VERSION"
for name in $uploaded; do
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $BITBUCKET_RELEASE_TOKEN" \
    --form "files=@$artifacts_dir/$name" \
    "$api" > /dev/null
  echo "  uploaded $name"
done

# A version that left its pool must stop being installable.
for name in $doomed; do
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --request DELETE \
    --header "Authorization: Bearer $BITBUCKET_RELEASE_TOKEN" \
    "$api/$name")
  case "$code" in
    204 | 404) echo "  removed $name" ;;
    *)
      echo "publish-artifacts: could not remove $name (HTTP $code)" >&2
      exit 1
      ;;
  esac
done

# Read everything back, so the published bytes are the ones that were built.
mkdir -p build/verify
for name in $uploaded; do
  curl --fail --silent --show-error --location \
    --output "build/verify/$name" \
    "$downloads/$name?release=${BITBUCKET_COMMIT:-local}"
  cmp "$artifacts_dir/$name" "build/verify/$name"
done
echo "Verified every uploaded file against the download area"

# The channel state is the audit trail for every pool change and revocation, so
# it belongs in the repository, not only in the build workspace.
mkdir -p build
cp .release/channels.json build/channels.json.new
git checkout --quiet -- .release/channels.json
git fetch --quiet --depth 1 origin main
git checkout --quiet -B channel-state FETCH_HEAD
cp build/channels.json.new .release/channels.json
git add .release/channels.json

if git diff --cached --quiet; then
  echo "Channel state is unchanged; nothing to record"
else
  git -c user.email=release-bot@minebench.cloud -c user.name="MineBench Release" \
    commit --quiet -m "chore(release): publish $CHANNEL $VERSION [skip ci]"

  # `[skip ci]` keeps this commit from starting another nightly build.
  push_url="https://x-token-auth:${BITBUCKET_RELEASE_TOKEN}@bitbucket.org/$workspace/$repo.git"
  if ! git push --quiet "$push_url" channel-state:main 2> build/push.err; then
    # Never let the token reach the log.
    sed -e "s|$BITBUCKET_RELEASE_TOKEN|***|g" build/push.err >&2
    exit 1
  fi
  echo "Recorded the new channel state on main"
fi
