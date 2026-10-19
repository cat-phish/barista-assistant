#!/bin/sh
# One-time setup of the test database on an existing db volume (new volumes get
# it from docker/mariadb-init). The root password is read from the container's
# secret file, so it never leaves the container.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T db sh -c 'MYSQL_PWD="$(cat /run/secrets/db_root_password)" mariadb -uroot' \
  < docker/mariadb-init/10-test-database.sql
echo "coffee_journal_test is ready."
