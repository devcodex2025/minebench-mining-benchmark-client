#!/bin/sh
# Removes only this channel's update-source registration.
set -e

rm -rf /etc/minebench/stable
# Fails while another channel is installed, and that is the point.
rmdir /etc/minebench 2>/dev/null || true

exit 0
