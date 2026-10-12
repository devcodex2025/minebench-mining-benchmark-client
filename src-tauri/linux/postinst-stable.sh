#!/bin/sh
# Registers where this installation gets its updates from.
#
# One directory per channel: this package overwrites its own file on every
# install, so a moved repository is picked up by upgrading the package and no
# duplicate or stale entry can appear. Files of other channels are never touched.
set -e

CHANNEL=stable
DOWNLOAD_BASE="https://bitbucket.org/minebenchapp/minebench-client/downloads/"
DIR="/etc/minebench/$CHANNEL"

mkdir -p "$DIR"
cat > "$DIR/update-source.json" <<JSON
{
  "schemaVersion": 1,
  "channel": "$CHANNEL",
  "downloadsBase": "$DOWNLOAD_BASE"
}
JSON
chmod 0644 "$DIR/update-source.json"

exit 0
