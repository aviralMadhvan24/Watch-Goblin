#!/bin/sh
# Creates the dedicated integration-test database alongside the dev database.
# Runs once, the first time the postgres volume is initialised.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE DATABASE watchgoblin_test OWNER $POSTGRES_USER;
SQL
