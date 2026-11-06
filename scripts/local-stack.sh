#!/usr/bin/env bash
# Local Supabase-compatible stack for development and automated tests.
#
#   bash scripts/local-stack.sh up      # start (idempotent), apply migrations + seed
#   bash scripts/local-stack.sh reset   # drop data and re-apply migrations + seed
#   bash scripts/local-stack.sh down    # stop and remove containers
#
# Prefer the official Supabase CLI (`supabase start`) when it is available —
# this script exists for environments where the CLI binary can't be installed.
# It runs the same open-source images: Postgres, GoTrue (auth), PostgREST,
# Storage API, Edge Runtime, and Mailpit (catches auth emails at :8025).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
STATE=$ROOT/.local-stack
mkdir -p "$STATE/storage"

PG_IMAGE=supabase/postgres:15.19.0.018
AUTH_IMAGE=supabase/gotrue:v2.197.0
REST_IMAGE=postgrest/postgrest:v12.2.12
STORAGE_IMAGE=supabase/storage-api:v1.89.11
EDGE_IMAGE=supabase/edge-runtime:v1.77.9
REALTIME_IMAGE=supabase/realtime:v2.34.47
MAIL_IMAGE=axllent/mailpit:latest
PGPASS=${LOCAL_PG_PASSWORD:-postgres-local-dev}
SITE_URL=${SITE_URL:-http://localhost:5173}

if [[ ! -f $STATE/keys.env ]]; then node scripts/local-stack/keys.mjs > "$STATE/keys.env"; fi
# shellcheck disable=SC1091
source "$STATE/keys.env"

psql_admin() { PGPASSWORD=$PGPASS psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }

wait_for() { # name cmd...
  local name=$1; shift
  for _ in $(seq 1 60); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done
  echo "!! $name did not become ready" >&2; docker logs --tail 40 "dish-$name" >&2 || true; exit 1
}

run() { # name image [docker opts...] [-- container args...]
  local name=$1 image=$2; shift 2
  local opts=() args=()
  while [[ $# -gt 0 && $1 != "--" ]]; do opts+=("$1"); shift; done
  [[ ${1:-} == "--" ]] && shift && args=("$@")
  if docker ps --format '{{.Names}}' | grep -qx "dish-$name"; then return; fi
  docker rm -f "dish-$name" >/dev/null 2>&1 || true
  docker run -d --name "dish-$name" --network host --restart unless-stopped "${opts[@]}" "$image" "${args[@]}" >/dev/null
}

apply_sql() {
  for f in "$ROOT"/supabase/migrations/*.sql; do
    local v; v=$(basename "$f")
    if [[ $(psql_admin -tAc "select 1 from public._local_migrations where version='$v'" 2>/dev/null) == 1 ]]; then continue; fi
    echo "   migration $v"
    psql_admin -f "$f"
    psql_admin -c "insert into public._local_migrations(version) values ('$v')"
  done
  echo "   seed"
  psql_admin -f "$ROOT/supabase/seed.sql"
  psql_admin -c "notify pgrst, 'reload schema'"
}

up() {
  echo "▸ db"
  run db $PG_IMAGE -e POSTGRES_PASSWORD="$PGPASS" -e PGPORT=54322 -e POSTGRES_PORT=54322 -e JWT_SECRET="$JWT_SECRET" \
    -v dish-pgdata:/var/lib/postgresql/data -- postgres -c port=54322 -c config_file=/etc/postgresql/postgresql.conf
  wait_for db psql_admin -c 'select 1'
  sleep 2
  wait_for db psql_admin -c 'select 1'
  psql_admin -c "alter role authenticator with password '$PGPASS'; alter role supabase_auth_admin with password '$PGPASS'; alter role supabase_storage_admin with password '$PGPASS';"

  echo "▸ mail"
  run mail $MAIL_IMAGE -e MP_SMTP_BIND_ADDR=0.0.0.0:1025 -e MP_UI_BIND_ADDR=0.0.0.0:8025

  echo "▸ auth"
  run auth $AUTH_IMAGE \
    -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:54321/auth/v1 \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PGPASS@127.0.0.1:54322/postgres" \
    -e GOTRUE_SITE_URL="$SITE_URL" -e GOTRUE_URI_ALLOW_LIST="$SITE_URL/**,http://localhost:4173/**,http://127.0.0.1:4173/**,http://127.0.0.1:5173/**" \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=1025 \
    -e GOTRUE_SMTP_ADMIN_EMAIL=hello@dish.local -e GOTRUE_SMTP_SENDER_NAME=DISH -e GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify \
    -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify \
    -e GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify -e GOTRUE_RATE_LIMIT_EMAIL_SENT="${AUTH_EMAIL_RATE_LIMIT:-1000}" -e GOTRUE_PASSWORD_MIN_LENGTH=8 \
    -e GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
  wait_for auth curl -sf http://127.0.0.1:9999/health

  echo "▸ storage"
  run storage $STORAGE_IMAGE -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_ROLE_KEY" -e AUTH_JWT_SECRET="$JWT_SECRET" -e PGRST_JWT_SECRET="$JWT_SECRET" \
    -e DATABASE_URL="postgres://supabase_storage_admin:$PGPASS@127.0.0.1:54322/postgres" -e STORAGE_BACKEND=file \
    -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=local -e GLOBAL_S3_BUCKET=stub \
    -e FILE_SIZE_LIMIT=52428800 -e ENABLE_IMAGE_TRANSFORMATION=false -e SERVER_PORT=5000 -e DB_INSTALL_ROLES=false \
    -v "$STATE/storage:/var/lib/storage"
  wait_for storage curl -sf http://127.0.0.1:5000/status

  echo "▸ schema"
  psql_admin -c "create table if not exists public._local_migrations (version text primary key, applied_at timestamptz default now()); revoke all on public._local_migrations from anon, authenticated;"
  apply_sql

  echo "▸ rest"
  run rest $REST_IMAGE -e PGRST_DB_URI="postgres://authenticator:$PGPASS@127.0.0.1:54322/postgres" -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_SERVER_PORT=3001 -e PGRST_DB_USE_LEGACY_GUCS=false \
    -e PGRST_APP_SETTINGS_JWT_SECRET="$JWT_SECRET"
  wait_for rest curl -sf http://127.0.0.1:3001/

  echo "▸ realtime"
  # Supabase Realtime (live plan updates, presence). Tenant "realtime-dev" is seeded; the
  # gateway sends /realtime/v1 there. Policies on realtime.messages need its schema, so
  # they are (re)applied once it has migrated.
  psql_admin -c "create schema if not exists _realtime"
  # The image listens on IPv6 only; some sandboxes have no IPv6, so use a copy of its
  # runtime config that listens on IPv4 (local development only).
  if [[ ! -f $STATE/realtime-runtime.exs ]]; then
    docker run --rm --entrypoint cat $REALTIME_IMAGE /app/releases/2.34.47/runtime.exs | sed 's/socket_opts: \[:inet6\]/socket_opts: [:inet]/' > "$STATE/realtime-runtime.exs"
  fi
  run realtime $REALTIME_IMAGE -v "$STATE/realtime-runtime.exs:/app/releases/2.34.47/runtime.exs:ro" -e DB_IP_VERSION=ipv4 -e PORT=4000 -e DB_HOST=127.0.0.1 -e DB_PORT=54322 -e DB_USER=supabase_admin \
    -e DB_PASSWORD="$PGPASS" -e DB_NAME=postgres -e DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime' \
    -e DB_ENC_KEY=supabaserealtime -e API_JWT_SECRET="$JWT_SECRET" -e SECRET_KEY_BASE="${JWT_SECRET}${JWT_SECRET}" \
    -e ERL_AFLAGS='-proto_dist inet_tcp' -e DNS_NODES="''" -e RLIMIT_NOFILE=10000 -e APP_NAME=realtime \
    -e SEED_SELF_HOST=true -e RUN_JANITOR=true
  wait_for realtime curl -s -o /dev/null http://127.0.0.1:4000/
  for _ in $(seq 1 60); do [[ $(psql_admin -tAc "select to_regclass('realtime.messages') is not null") == t ]] && break; sleep 1; done
  psql_admin -f "$ROOT/scripts/local-stack/realtime.sql"

  echo "▸ functions"
  local envfile=$STATE/functions.env
  # IMAGE_PROVIDER=mock: catalogue image generation works locally without a key.
  # DISH_DEV_TOOLS=enabled: Developer Mode simulation (test accounts only); never set on hosted projects.
  # (placeholder image); supabase/functions/.env can override it.
  { echo "SUPABASE_URL=http://127.0.0.1:54321"; echo "SUPABASE_ANON_KEY=$ANON_KEY"; echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"; echo "IMAGE_PROVIDER=mock"; echo "DISH_DEV_TOOLS=enabled"; echo "DISH_ENVIRONMENT=development";
    [[ -f $ROOT/supabase/functions/.env ]] && grep -v '^#' "$ROOT/supabase/functions/.env" || true; } > "$envfile"
  # Optional (LOCAL_NPM_MIRROR=1): for sandboxes whose TLS-intercepting proxy Deno
  # can't trust, serve npm packages through a local Node mirror instead.
  local registry=https://registry.npmjs.org/
  if [[ ${LOCAL_NPM_MIRROR:-0} == 1 ]]; then
    if ! curl -s -o /dev/null http://127.0.0.1:4873/ 2>/dev/null; then
      nohup node scripts/local-stack/npm-mirror.mjs > "$STATE/npm-mirror.log" 2>&1 & echo $! > "$STATE/npm-mirror.pid"; sleep 1
    fi
    registry=http://127.0.0.1:4873/
  fi
  run functions $EDGE_IMAGE --env-file "$envfile" -e NPM_CONFIG_REGISTRY=$registry \
    -v "$ROOT/supabase/functions:/home/deno/functions:ro" -v "$ROOT/scripts/local-stack/functions-main:/home/deno/main:ro" \
    -- start --main-service /home/deno/main -p 9000
  sleep 2

  echo "▸ gateway"
  if ! curl -s -o /dev/null http://127.0.0.1:54321/rest/v1/ 2>/dev/null; then
    nohup node scripts/local-stack/gateway.mjs > "$STATE/gateway.log" 2>&1 &
    echo $! > "$STATE/gateway.pid"
    sleep 1
  fi

  cat > "$ROOT/.env.local" <<ENV
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=$ANON_KEY
ENV
  echo
  echo "✓ Local stack ready"
  echo "  API      http://localhost:54321   (keys in .local-stack/keys.env, .env.local written)"
  echo "  Mail UI  http://localhost:8025    (verification & reset emails)"
  echo "  DB       postgres://supabase_admin:$PGPASS@localhost:54322/postgres"
}

down() {
  for n in functions realtime rest storage auth mail db; do docker rm -f "dish-$n" >/dev/null 2>&1 || true; done
  for p in gateway npm-mirror; do
    [[ -f $STATE/$p.pid ]] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null || true
    rm -f "$STATE/$p.pid"
  done
}

reset() {
  down
  docker volume rm dish-pgdata >/dev/null 2>&1 || true
  rm -rf "$STATE/storage"
  mkdir -p "$STATE/storage"
  up
}

case ${1:-up} in
  up) up ;;
  down) down ;;
  reset) reset ;;
  *) echo "usage: $0 up|down|reset"; exit 1 ;;
esac
