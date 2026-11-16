#!/usr/bin/env bash
# scripts/backup_offsite.sh against a local S3-compatible stub (s3_stub.py, which
# checks every Signature Version 4 the way S3 does):
# - no configuration: a notice, exit 0, no request;
# - the newest stamp goes up encrypted, verified, and decrypts (with a throwaway
#   test key) to the same bytes;
# - a second run does not upload it again; retention keeps the newest N objects
#   and nothing outside strikehike/*.tar.enc;
# - --fetch downloads it; a wrong secret warns, exits 1 and deletes nothing;
# - no secret reaches the output;
# - the python3 signer (curl older than 7.88.1) gives the same result;
# - the deploy passes the configuration through and calls the script after
#   backup_runtime.sh, warn-only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/backup_offsite.sh"
STUB="$ROOT/tests/deploy/s3_stub.py"
WORKFLOW="$ROOT/.github/workflows/deploy-lightsail.yml"
PYTHON="${PYTHON:-python3}"
WORK="$(mktemp -d)"
STUB_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

for tool in curl openssl tar; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done
"$PYTHON" "$STUB" --self-test >/dev/null

KEY_ID="AKIDTESTOFFSITE01"
SECRET="test/Secret+Value=0123456789abcdefOFFSITE"
BUCKET="sh-test-backups"
REGION="us-test-1"
MARKER="offsite-plaintext-marker-7f3a9c"

# --- a throwaway recipient (test only; the real private key never exists here)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/test.key" -out "$WORK/test.crt" \
  -days 2 -subj "/CN=offsite-test" >/dev/null 2>&1

# --- two local stamps; the newest holds sqlite, events and a marker ----------
BACKUPS="$WORK/backups"
OLD="$BACKUPS/20261115T000000Z"
NEW="$BACKUPS/20261116T000000Z"
mkdir -p "$OLD" "$NEW/events/bundles/b1"
printf 'older\n' > "$OLD/note.txt"
"$PYTHON" - "$NEW/analytics.sqlite" "$MARKER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as con:
    con.execute("CREATE TABLE marker(value TEXT)")
    con.execute("INSERT INTO marker VALUES (?)", (sys.argv[2],))
PY
printf '{"bundle":"b1","note":"%s"}\n' "$MARKER" > "$NEW/events/bundles/b1/bundle.json"
printf 'bundles/b1\n' > "$NEW/events/current"
head -c 200000 /dev/urandom > "$NEW/historical_events.db"

# --- the stub: pages of 7 keys, so retention has to follow the listing -----
STORE="$WORK/store"
LOG="$WORK/requests.log"
mkdir -p "$STORE"
"$PYTHON" "$STUB" --root "$STORE" --bucket "$BUCKET" --key-id "$KEY_ID" --secret "$SECRET" \
  --region "$REGION" --port-file "$WORK/port" --page-size 7 --log "$LOG" &
STUB_PID=$!
for _ in $(seq 1 50); do [ -s "$WORK/port" ] && break; sleep 0.1; done
[ -s "$WORK/port" ] || fail "stub did not start"
PORT="$(cat "$WORK/port")"
OBJECT="$STORE/$BUCKET/strikehike/20261116T000000Z.tar.enc"
requests() { [ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0; }

run() {
  # run NAME [env...] -- args: output in $WORK/NAME.out, status in $WORK/NAME.status
  local name="$1"; shift
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  local status=0
  env -u BACKUP_S3_ENDPOINT -u BACKUP_S3_BUCKET -u BACKUP_S3_REGION -u BACKUP_S3_KEY_ID \
    -u BACKUP_S3_SECRET -u BACKUP_RECIPIENT_CERT -u BACKUP_OFFSITE_SIGNER \
    "${envs[@]}" bash "$SCRIPT" --src-root "$BACKUPS" "$@" > "$WORK/$name.out" 2>&1 || status=$?
  echo "$status" > "$WORK/$name.status"
}
CONFIG=(
  "BACKUP_S3_ENDPOINT=http://127.0.0.1:$PORT"
  "BACKUP_S3_BUCKET=$BUCKET"
  "BACKUP_S3_REGION=$REGION"
  "BACKUP_S3_KEY_ID=$KEY_ID"
  "BACKUP_S3_SECRET=$SECRET"
  "BACKUP_RECIPIENT_CERT=$(cat "$WORK/test.crt")"
)
status_of() { cat "$WORK/$1.status"; }

# 1. Not configured: a notice, exit 0, no request at all.
run none --
[ "$(status_of none)" = "0" ] || fail "unconfigured run exited $(status_of none)"
grep -q '::notice::off-host backup is not configured' "$WORK/none.out" || fail "no notice: $(cat "$WORK/none.out")"
run partial "${CONFIG[@]:0:4}" "BACKUP_RECIPIENT_CERT=$(cat "$WORK/test.crt")" --
[ "$(status_of partial)" = "0" ] || fail "partly configured run exited $(status_of partial)"
grep -q 'missing: BACKUP_S3_SECRET)' "$WORK/partial.out" || fail "partial notice: $(cat "$WORK/partial.out")"
[ "$(requests)" = "0" ] || fail "an unconfigured run reached the endpoint"

# 2. Upload: encrypted, verified, the newest stamp only.
run upload "${CONFIG[@]}" -- --keep 30
[ "$(status_of upload)" = "0" ] || fail "upload exited $(status_of upload): $(cat "$WORK/upload.out")"
grep -q '^off-host: signing with ' "$WORK/upload.out" || fail "no signer line"
grep -q 'off-host: strikehike/20261116T000000Z.tar.enc (.* bytes, encrypted, verified)' "$WORK/upload.out" \
  || fail "no upload line: $(cat "$WORK/upload.out")"
[ -s "$OBJECT" ] || fail "object not stored"
[ ! -e "$STORE/$BUCKET/strikehike/20261115T000000Z.tar.enc" ] || fail "an older stamp was uploaded"
[ "$(head -c 1 "$OBJECT" | od -An -tx1 | tr -d ' ')" = "30" ] || fail "object is not DER"
if grep -aq "$MARKER" "$OBJECT"; then fail "plaintext marker visible in the object"; fi
if [ "$(head -c 2 "$OBJECT" | od -An -tx1 | tr -d ' ')" = "1f8b" ]; then fail "object is a bare gzip"; fi
grep -q '"method": "PUT"' "$LOG" || fail "no PUT"
grep -q '"method": "HEAD"' "$LOG" || fail "no HEAD verification"

# 3. Round trip with the throwaway private key: identical bytes.
decrypt_into() {
  local object="$1" dir="$2"
  mkdir -p "$dir"
  openssl cms -decrypt -binary -inform DER -in "$object" -inkey "$WORK/test.key" \
    -recip "$WORK/test.crt" -out "$dir.tar.gz"
  tar -C "$dir" -xzf "$dir.tar.gz"
}
decrypt_into "$OBJECT" "$WORK/restored"
diff -r "$NEW" "$WORK/restored/20261116T000000Z" >/dev/null || fail "restored stamp differs"
cmp "$NEW/historical_events.db" "$WORK/restored/20261116T000000Z/historical_events.db" \
  || fail "binary file differs"
"$PYTHON" - "$WORK/restored/20261116T000000Z/analytics.sqlite" "$MARKER" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as con:
    assert con.execute("SELECT value FROM marker").fetchone()[0] == sys.argv[2]
PY

# 4. A second run finds the object and does not upload it again.
SUM_BEFORE="$(openssl dgst -sha256 -r "$OBJECT" | cut -d' ' -f1)"
PUTS_BEFORE="$(grep -c '"method": "PUT"' "$LOG")"
run again "${CONFIG[@]}" --
[ "$(status_of again)" = "0" ] || fail "second run exited $(status_of again)"
grep -q 'already stored; not uploaded again' "$WORK/again.out" || fail "second run: $(cat "$WORK/again.out")"
[ "$(grep -c '"method": "PUT"' "$LOG")" = "$PUTS_BEFORE" ] || fail "second run uploaded again"
[ "$(openssl dgst -sha256 -r "$OBJECT" | cut -d' ' -f1)" = "$SUM_BEFORE" ] || fail "object changed"

# 5. Retention: 35 older objects plus two that are not ours; keep 5.
for day in $(seq -w 1 30) ; do
  printf 'old' > "$STORE/$BUCKET/strikehike/202510${day}T000000Z.tar.enc"
done
for day in $(seq -w 1 5); do
  printf 'old' > "$STORE/$BUCKET/strikehike/202509${day}T000000Z.tar.enc"
done
mkdir -p "$STORE/$BUCKET/other"
printf 'keep' > "$STORE/$BUCKET/strikehike/notes.txt"
printf 'keep' > "$STORE/$BUCKET/other/20200101T000000Z.tar.enc"
LISTS_BEFORE="$(grep -c '"method": "GET", "path": "/'"$BUCKET"'?' "$LOG" || true)"
run retention "${CONFIG[@]}" -- --keep 5
[ "$(status_of retention)" = "0" ] || fail "retention run exited $(status_of retention): $(cat "$WORK/retention.out")"
grep -q 'off-host retention: 5 kept (newest 5), 31 removed' "$WORK/retention.out" \
  || fail "retention line: $(cat "$WORK/retention.out")"
LEFT="$(cd "$STORE/$BUCKET/strikehike" && ls -1 ./*.tar.enc | sed 's|^\./||' | LC_ALL=C sort | tr '\n' ' ')"
EXPECTED="20251027T000000Z.tar.enc 20251028T000000Z.tar.enc 20251029T000000Z.tar.enc 20251030T000000Z.tar.enc 20261116T000000Z.tar.enc "
[ "$LEFT" = "$EXPECTED" ] || fail "retention kept: $LEFT"
[ -f "$STORE/$BUCKET/strikehike/notes.txt" ] || fail "retention removed a non-backup object"
[ -f "$STORE/$BUCKET/other/20200101T000000Z.tar.enc" ] || fail "retention reached outside the prefix"
LISTS_AFTER="$(grep -c '"method": "GET", "path": "/'"$BUCKET"'?' "$LOG")"
[ "$((LISTS_AFTER - LISTS_BEFORE))" -ge 6 ] || fail "the listing was not paginated"

# 6. --list and --fetch latest: the same object, still encrypted.
run list "${CONFIG[@]}" -- --list
[ "$(status_of list)" = "0" ] || fail "--list exited $(status_of list)"
[ "$(head -n 1 "$WORK/list.out")" = "strikehike/20261116T000000Z.tar.enc" ] || fail "--list: $(cat "$WORK/list.out")"
run fetch "${CONFIG[@]}" -- --fetch latest --out "$WORK/fetched.tar.enc"
[ "$(status_of fetch)" = "0" ] || fail "--fetch exited $(status_of fetch): $(cat "$WORK/fetch.out")"
cmp "$OBJECT" "$WORK/fetched.tar.enc" || fail "fetched bytes differ"
decrypt_into "$WORK/fetched.tar.enc" "$WORK/fetched"
diff -r "$NEW" "$WORK/fetched/20261116T000000Z" >/dev/null || fail "fetched stamp differs"

# 7. A wrong secret: a warning, exit 1, nothing uploaded or deleted. (The object
#    is removed first so the python-signer run below uploads it afresh.)
printf 'old' > "$STORE/$BUCKET/strikehike/20250101T000000Z.tar.enc"
rm -f "$OBJECT"
BAD=("${CONFIG[@]}")
BAD[4]="BACKUP_S3_SECRET=wrong/${SECRET}"
run wrong "${BAD[@]}" -- --keep 1
[ "$(status_of wrong)" = "1" ] || fail "wrong secret exited $(status_of wrong)"
grep -q '::warning::off-host backup: checking strikehike/20261116T000000Z.tar.enc: HTTP 403' "$WORK/wrong.out" \
  || fail "wrong secret: $(cat "$WORK/wrong.out")"
[ ! -e "$OBJECT" ] || fail "a refused run stored the object"
[ -f "$STORE/$BUCKET/strikehike/20250101T000000Z.tar.enc" ] || fail "a failed run deleted an object"
run wronglist "${BAD[@]}" -- --list
[ "$(status_of wronglist)" = "1" ] || fail "wrong secret --list exited $(status_of wronglist)"
grep -q 'listing strikehike/: HTTP 403 (SignatureDoesNotMatch)' "$WORK/wronglist.out" \
  || fail "wrong secret --list: $(cat "$WORK/wronglist.out")"

# 8. Plain HTTP to another host is refused before any request.
BEFORE="$(requests)"
NOHTTP=("${CONFIG[@]}")
NOHTTP[0]="BACKUP_S3_ENDPOINT=http://backups.example.invalid"
run plainhttp "${NOHTTP[@]}" --
[ "$(status_of plainhttp)" = "1" ] || fail "plain http exited $(status_of plainhttp)"
grep -q 'must use https' "$WORK/plainhttp.out" || fail "plain http: $(cat "$WORK/plainhttp.out")"
[ "$(requests)" = "$BEFORE" ] || fail "plain http reached the stub"

# 9. The python3 signer (hosts with curl older than 7.88.1): upload, verify, retain.
run pysign "${CONFIG[@]}" BACKUP_OFFSITE_SIGNER=python -- --keep 2
[ "$(status_of pysign)" = "0" ] || fail "python signer exited $(status_of pysign): $(cat "$WORK/pysign.out")"
grep -q 'signing with python3 (set by BACKUP_OFFSITE_SIGNER' "$WORK/pysign.out" || fail "python signer not used"
grep -q 'encrypted, verified' "$WORK/pysign.out" || fail "python signer: $(cat "$WORK/pysign.out")"
grep -q 'off-host retention: 2 kept (newest 2)' "$WORK/pysign.out" || fail "python signer retention"
decrypt_into "$OBJECT" "$WORK/pysigned"
diff -r "$NEW" "$WORK/pysigned/20261116T000000Z" >/dev/null || fail "python-signed stamp differs"

# 10. No output names a secret, the key id, the endpoint or the bucket.
for out in "$WORK"/*.out; do
  for value in "$SECRET" "$KEY_ID" "127.0.0.1:$PORT" "$BUCKET"; do
    if grep -qF -- "$value" "$out"; then fail "$(basename "$out") printed a configuration value"; fi
  done
done

# 11. The deploy: configuration passed through, called after backup_runtime.sh, warn-only.
for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_REGION BACKUP_S3_KEY_ID BACKUP_S3_SECRET; do
  grep -q "${name}: \${{ secrets.${name} }}" "$WORKFLOW" || fail "$name is not passed as a secret"
done
grep -q 'BACKUP_RECIPIENT_CERT: ${{ vars.BACKUP_RECIPIENT_CERT }}' "$WORKFLOW" || fail "cert variable not passed"
ENVS_LINE="$(grep -E '^ +envs: ' "$WORKFLOW")"
for name in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_REGION BACKUP_S3_KEY_ID BACKUP_S3_SECRET BACKUP_RECIPIENT_CERT; do
  printf '%s' "$ENVS_LINE" | grep -q "$name" || fail "$name is missing from envs"
done
RUNTIME_LINE="$(grep -n 'bash scripts/backup_runtime.sh' "$WORKFLOW" | head -n 1 | cut -d: -f1)"
OFFSITE_LINE="$(grep -n 'if ! bash scripts/backup_offsite.sh' "$WORKFLOW" | head -n 1 | cut -d: -f1)"
[ -n "$OFFSITE_LINE" ] && [ "$OFFSITE_LINE" -gt "$RUNTIME_LINE" ] || fail "deploy does not run the off-host copy after the runtime backup"

echo "backup offsite: no-op unconfigured, encrypted upload verified, round trip identical, retention trims, secrets unprinted"
