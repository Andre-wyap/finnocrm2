#!/usr/bin/env bash
# FINNO CRM — enable SSL on the Postgres container and expose it for the
# Hostinger-hosted app. Run on the VPS as root:
#
#   bash db/expose-ssl.sh
#
# Safe to re-run. Keeps the old container (stopped + renamed) as a rollback.
set -euo pipefail

CONTAINER=crm-postgres
CERT_DIR=/opt/pg-certs
PUBLIC_PORT=5432
PG_UID=999   # the postgres user inside the official image

echo "==> Checking container '$CONTAINER' exists..."
docker inspect "$CONTAINER" >/dev/null

# ── Warn if a compose file manages this container ─────────────────────────────
COMPOSE_HIT=$(grep -rls "$CONTAINER" /root /opt /home /srv 2>/dev/null | grep -E 'docker-compose.*\.ya?ml|compose\.ya?ml' || true)
if [ -n "$COMPOSE_HIT" ]; then
  echo "!! WARNING: this container looks compose-managed:"
  echo "$COMPOSE_HIT"
  echo "!! A 'docker run' recreate will work now, but a future 'docker compose up'"
  echo "!! would recreate it WITHOUT SSL. Tell Claude to edit the compose file instead."
  read -r -p "   Continue with docker run recreate anyway? [y/N] " ans
  [ "$ans" = "y" ] || { echo "Aborted."; exit 1; }
fi

# ── Step 1: SSL cert ──────────────────────────────────────────────────────────
echo "==> Generating self-signed cert in $CERT_DIR (if missing)..."
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/server.crt" ]; then
  openssl req -new -x509 -days 3650 -nodes -text \
    -out "$CERT_DIR/server.crt" \
    -keyout "$CERT_DIR/server.key" \
    -subj "/CN=finno-crm-db"
fi
chmod 600 "$CERT_DIR/server.key"
chown "$PG_UID:$PG_UID" "$CERT_DIR/server.key" "$CERT_DIR/server.crt"

# ── Step 2: capture current container config ──────────────────────────────────
echo "==> Reading current container config..."
IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')
NETWORK=$(docker inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')
RESTART=$(docker inspect "$CONTAINER" --format '{{.HostConfig.RestartPolicy.Name}}')
[ -z "$RESTART" ] || [ "$RESTART" = "no" ] && RESTART=unless-stopped

# Reuse the existing data volume(s) / binds exactly
VOL_ARGS=()
while IFS='|' read -r src dst; do
  [ -z "$dst" ] && continue
  VOL_ARGS+=( -v "${src}:${dst}" )
done < <(docker inspect "$CONTAINER" --format \
  '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}|{{.Destination}}{{"\n"}}{{end}}')

if [ ${#VOL_ARGS[@]} -eq 0 ]; then
  echo "!! Could not detect a data volume — refusing to recreate (would risk data loss)."
  exit 1
fi
echo "   Reusing volumes: ${VOL_ARGS[*]}"

# Preserve only the meaningful env (POSTGRES_* + locale); init vars are ignored
# on an existing data dir but we keep them so nothing surprises us.
ENV_ARGS=()
while IFS= read -r e; do
  case "$e" in
    POSTGRES_*|PG_*|LANG=*|LC_*|TZ=*) ENV_ARGS+=( -e "$e" );;
  esac
done < <(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}')

# Preserve the original command, then append SSL flags
CMD_ARR=()
while IFS= read -r c; do [ -n "$c" ] && CMD_ARR+=( "$c" ); done \
  < <(docker inspect "$CONTAINER" --format '{{range .Config.Cmd}}{{println .}}{{end}}')
[ ${#CMD_ARR[@]} -eq 0 ] && CMD_ARR=( postgres )

NET_ARG=()
case "$NETWORK" in
  ""|default|bridge) ;;                 # default bridge — nothing to pass
  *) NET_ARG=( --network "$NETWORK" );; # custom/compose network — preserve
esac

# ── Step 3: recreate ──────────────────────────────────────────────────────────
STAMP=$(date +%s)
echo "==> Stopping and renaming old container -> ${CONTAINER}_old_${STAMP}"
docker stop "$CONTAINER" >/dev/null
docker rename "$CONTAINER" "${CONTAINER}_old_${STAMP}"

echo "==> Starting new container with SSL + exposed port ${PUBLIC_PORT}..."
docker run -d \
  --name "$CONTAINER" \
  --restart "$RESTART" \
  "${NET_ARG[@]}" \
  "${VOL_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  -v "$CERT_DIR:/etc/pg-certs:ro" \
  -p "${PUBLIC_PORT}:5432" \
  "$IMAGE" \
  "${CMD_ARR[@]}" \
  -c ssl=on \
  -c ssl_cert_file=/etc/pg-certs/server.crt \
  -c ssl_key_file=/etc/pg-certs/server.key

echo "==> Waiting for Postgres to accept connections..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 \
     || docker exec "$CONTAINER" pg_isready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Verifying SSL is on:"
docker exec "$CONTAINER" psql -U crm_user -d finno_crm -tAc "show ssl;" || true

echo
echo "✓ Done."
echo "  New container is published on 0.0.0.0:${PUBLIC_PORT} with SSL."
echo "  Rollback if needed:  docker stop $CONTAINER && docker rename $CONTAINER ${CONTAINER}_broken && docker rename ${CONTAINER}_old_${STAMP} $CONTAINER && docker start $CONTAINER"
echo "  Once confirmed working, remove the backup:  docker rm ${CONTAINER}_old_${STAMP}"
echo
echo "  NEXT: 1) firewall port ${PUBLIC_PORT} to Hostinger's IP only"
echo "        2) set DATABASE_URL host to your VPS public IP with sslmode=require"
