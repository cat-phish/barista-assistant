-- Runs once, when the db volume is first created (after MariaDB has created
-- MARIADB_USER). The automated tests use this separate database and wipe it
-- on every run, so they can never touch coffee_journal.
-- For an existing volume, run: npm run test:db:create
CREATE DATABASE IF NOT EXISTS coffee_journal_test;
GRANT ALL PRIVILEGES ON coffee_journal_test.* TO 'barista'@'%';
