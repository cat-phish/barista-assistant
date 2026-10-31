#!/bin/sh
# Starts as root only to hand the app's user the folders in DATA_DIRS: Docker
# creates a missing bind mount as root, and tools like Unraid's New Permissions
# change the owner later. Then runs the app as that user. The MariaDB and Redis
# images do the same with theirs.
set -eu

if [ "$(id -u)" = 0 ]; then
  for dir in ${DATA_DIRS:-}; do
    if [ -d "$dir" ]; then
      find "$dir" ! -user node -exec chown node:node {} +
    fi
  done
  exec su-exec node "$@"
fi

exec "$@"
