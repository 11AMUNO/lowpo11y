#!/usr/bin/env bash
# Dumps the database, restores the dump into a scratch database, and checks
# that every table came back with the same number of rows. With
# BACKUP_PASSPHRASE set, the dump is then encrypted (AES-256, PBKDF2).
#
#   SOURCE_URL=postgres://...  SCRATCH_URL=postgres://.../scratch  OUT=backup  scripts/backup/backup-and-verify.sh
#
# The scratch database must be empty; it is wiped at the start. Needs
# pg_dump, pg_restore and psql of the server's major version (16).
set -euo pipefail
: "${SOURCE_URL:?SOURCE_URL is required}"
: "${SCRATCH_URL:?SCRATCH_URL is required}"
OUT="${OUT:-backup}"
mkdir -p "$OUT"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$OUT/lowpo11y-$stamp.dump"

pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=app --file="$dump" "$SOURCE_URL"
echo "Dumped $(du -h "$dump" | cut -f1) to $dump"

# A clean scratch database with the roles and extensions the schema refers to
# (a schema-filtered dump leaves both out; Supabase manages them itself).
psql -q -v ON_ERROR_STOP=1 "$SCRATCH_URL" <<'SQL'
drop schema if exists public cascade;
drop schema if exists app cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'lp_anon') then create role lp_anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'lp_authenticated') then create role lp_authenticated nologin; end if;
end $$;
SQL
# Schemas and tables first, then the trigram extension the search indexes need, then data and indexes.
pg_restore --no-owner --no-privileges --exit-on-error --section=pre-data --dbname="$SCRATCH_URL" "$dump"
psql -q -v ON_ERROR_STOP=1 "$SCRATCH_URL" -c "create extension if not exists pg_trgm with schema public"
pg_restore --no-owner --no-privileges --exit-on-error --section=data --section=post-data --dbname="$SCRATCH_URL" "$dump"

count_rows() {
  psql -At -v ON_ERROR_STOP=1 "$1" <<'SQL'
select string_agg(format('%s=%s', t, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t), false, true, '')))[1]::text), ' ' order by t)
  from (select tablename as t from pg_tables where schemaname = 'public') x;
SQL
}
before="$(count_rows "$SOURCE_URL")"
after="$(count_rows "$SCRATCH_URL")"
if [ "$before" != "$after" ]; then
  echo "Restore check FAILED: row counts differ" >&2
  diff <(tr ' ' '\n' <<<"$before") <(tr ' ' '\n' <<<"$after") >&2 || true
  exit 1
fi
echo "Restore check passed: $(wc -w <<<"$after") tables, same row counts."

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$dump" -out "$dump.enc" -pass env:BACKUP_PASSPHRASE
  rm "$dump"
  echo "Encrypted to $dump.enc (decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in FILE -out lowpo11y.dump)"
fi
