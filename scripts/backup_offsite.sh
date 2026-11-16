#!/usr/bin/env bash
# OFFSITE: an encrypted copy of the newest backup stamp, in an S3-compatible
# bucket (Backblaze B2, a Lightsail bucket, ...). The deploy runs it right after
# scripts/backup_runtime.sh.
#
#   bash scripts/backup_offsite.sh [--src-root DIR] [--keep N]   # upload the newest stamp
#   bash scripts/backup_offsite.sh --list                        # objects, newest first
#   bash scripts/backup_offsite.sh --fetch <stamp|latest> --out FILE   # download (still encrypted)
#
# Configuration, from the environment (the deploy passes GitHub secrets and one
# repository variable through the SSH session):
#   BACKUP_S3_ENDPOINT     https://s3.<region>.backblazeb2.com (path-style), or
#                          https://<bucket>.s3.<region>.amazonaws.com (virtual-hosted)
#   BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET
#   BACKUP_RECIPIENT_CERT  the PEM recipient certificate (public). Only its owner's
#                          private key, kept offline, can decrypt; the host cannot.
#
# - Missing configuration: a notice, exit 0, no network call.
# - The stamp is tarred (gzip) and encrypted on the host with openssl cms
#   (AES-256-CBC, the session key wrapped for the certificate with RSA-OAEP),
#   uploaded to <bucket>/strikehike/<stamp>.tar.enc with a signed payload hash,
#   and checked with HEAD (status and size). Plaintext never leaves the host and
#   is never written outside the stamp itself.
# - Only after a verified upload, the newest --keep (30) objects are kept and
#   older strikehike/*.tar.enc objects are deleted.
# - Any failure prints a ::warning:: and exits 1; the deploy carries on.
# - Secrets never reach the output, a command line or the process list: curl
#   reads the key pair from a 0600 file, and the signer reads the environment.
#
# Signing: curl --aws-sigv4 (curl 7.88.1 or newer). Older curl (Ubuntu 22.04
# ships 7.81, which leaves x-amz-content-sha256 unsigned and S3 refuses the
# request) gets the same Signature Version 4 from python3 instead.
set -euo pipefail
umask 077

SRC_ROOT="${HOME}/strikehike-backups"
KEEP="${BACKUP_OFFSITE_KEEP:-30}"
PREFIX="strikehike/"
MODE="upload"
FETCH=""
OUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --src-root) SRC_ROOT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --list) MODE="list"; shift ;;
    --fetch) MODE="fetch"; FETCH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

warn() {
  echo "::warning::off-host backup: $*"
}

# --- configuration --------------------------------------------------------
REQUIRED=(BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_REGION BACKUP_S3_KEY_ID BACKUP_S3_SECRET)
[ "$MODE" = "upload" ] && REQUIRED+=(BACKUP_RECIPIENT_CERT)
MISSING=()
for name in "${REQUIRED[@]}"; do
  [ -n "${!name:-}" ] || MISSING+=("$name")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "::notice::off-host backup is not configured (missing: ${MISSING[*]}); skipped."
  exit 0
fi

ENDPOINT="${BACKUP_S3_ENDPOINT%/}"
BUCKET="$BACKUP_S3_BUCKET"
REGION="$BACKUP_S3_REGION"

if ! [[ "$ENDPOINT" =~ ^(https?)://([A-Za-z0-9.-]+)(:([0-9]{1,5}))?$ ]]; then
  warn "BACKUP_S3_ENDPOINT must be scheme://host[:port] with no path."
  exit 1
fi
SCHEME="${BASH_REMATCH[1]}"
HOSTNAME_ONLY="${BASH_REMATCH[2]}"
PORT="${BASH_REMATCH[4]}"
# Plain HTTP only to this machine (the test stub); a real bucket is HTTPS.
if [ "$SCHEME" = "http" ] && [ "$HOSTNAME_ONLY" != "127.0.0.1" ] && [ "$HOSTNAME_ONLY" != "localhost" ]; then
  warn "BACKUP_S3_ENDPOINT must use https."
  exit 1
fi
if ! [[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  warn "BACKUP_S3_BUCKET is not a valid bucket name."
  exit 1
fi
if ! [[ "$REGION" =~ ^[a-z0-9-]{2,40}$ ]]; then
  warn "BACKUP_S3_REGION is not a valid region name."
  exit 1
fi
if ! [[ "$BACKUP_S3_KEY_ID" =~ ^[A-Za-z0-9._/+=-]{4,128}$ ]]; then
  warn "BACKUP_S3_KEY_ID has unexpected characters."
  exit 1
fi
case "$BACKUP_S3_SECRET" in
  *[[:space:]]*|*'"'*|*\\*) warn "BACKUP_S3_SECRET has whitespace, a quote or a backslash."; exit 1 ;;
esac
if ! [[ "$KEEP" =~ ^[1-9][0-9]{0,3}$ ]]; then
  warn "--keep must be a whole number from 1 to 9999."
  exit 1
fi

for tool in curl openssl tar python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    warn "$tool is not installed."
    exit 1
  fi
done

# Host header as curl sends it: the port only when it is not the default.
HOST_HEADER="$HOSTNAME_ONLY"
if [ -n "$PORT" ] && ! { [ "$SCHEME" = "https" ] && [ "$PORT" = "443" ]; } \
  && ! { [ "$SCHEME" = "http" ] && [ "$PORT" = "80" ]; }; then
  HOST_HEADER="${HOSTNAME_ONLY}:${PORT}"
fi
# A host that starts with "<bucket>." is a virtual-hosted endpoint.
if [[ "$HOSTNAME_ONLY" == "$BUCKET."* ]]; then
  OBJECT_BASE="/"
  LIST_PATH="/"
else
  OBJECT_BASE="/${BUCKET}/"
  LIST_PATH="/${BUCKET}"
fi

curl_at_least() {
  # curl_at_least 7.88.1 -> 0 when the installed curl is that version or newer.
  local have
  have="$(curl --version | head -n 1 | awk '{print $2}')"
  python3 - "$have" "$1" <<'PY'
import re, sys
def parts(value):
    return tuple(int(x) for x in re.findall(r"\d+", value)[:3])
sys.exit(0 if parts(sys.argv[1]) >= parts(sys.argv[2]) else 1)
PY
}

SIGNER="${BACKUP_OFFSITE_SIGNER:-}"
SIGNER_NOTE="set by BACKUP_OFFSITE_SIGNER"
if [ -z "$SIGNER" ]; then
  SIGNER_NOTE="curl $(curl --version | head -n 1 | awk '{print $2}')"
  if curl_at_least 7.88.1; then SIGNER="curl"; else SIGNER="python"; fi
fi
case "$SIGNER" in
  curl|python) ;;
  *) warn "BACKUP_OFFSITE_SIGNER must be curl or python."; exit 1 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# curl reads the key pair from here, never from its command line.
CREDENTIALS="$WORK/credentials.curlrc"
if [ "$SIGNER" = "curl" ]; then
  printf 'user = "%s:%s"\n' "$BACKUP_S3_KEY_ID" "$BACKUP_S3_SECRET" > "$CREDENTIALS"
fi

EMPTY_SHA256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

# Signature Version 4 headers for curl releases older than 7.88.1, as a curl
# config file. Reads the key pair from the environment.
python_sign() {
  local method="$1" path="$2" query="$3" payload="$4"
  python3 - "$method" "$HOST_HEADER" "$path" "$query" "$payload" <<'PY'
import datetime, hashlib, hmac, os, sys
from urllib.parse import quote, unquote

method, host, path, query, payload = sys.argv[1:6]
region = os.environ["BACKUP_S3_REGION"]
key_id = os.environ["BACKUP_S3_KEY_ID"]
secret = os.environ["BACKUP_S3_SECRET"]
amz_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
day = amz_date[:8]

def enc(value):
    return quote(value, safe="-_.~")

pairs = sorted(
    (enc(unquote(name)), enc(unquote(value)))
    for name, _, value in (part.partition("=") for part in query.split("&") if part)
)
signed = "host;x-amz-content-sha256;x-amz-date"
canonical = "\n".join([
    method,
    path,
    "&".join(f"{name}={value}" for name, value in pairs),
    f"host:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz_date}\n",
    signed,
    payload,
])
scope = f"{day}/{region}/s3/aws4_request"
to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
key = hmac.new(f"AWS4{secret}".encode(), day.encode(), hashlib.sha256).digest()
for part in (region, "s3", "aws4_request"):
    key = hmac.new(key, part.encode(), hashlib.sha256).digest()
signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
print(f'header = "Authorization: AWS4-HMAC-SHA256 Credential={key_id}/{scope}, '
      f'SignedHeaders={signed}, Signature={signature}"')
print(f'header = "x-amz-date: {amz_date}"')
PY
}

# s3 METHOD PATH QUERY BODY_OUT [UPLOAD_FILE PAYLOAD_SHA256]
# Prints the HTTP status (000 when there was no answer). Response headers are
# left in $WORK/headers, the body in BODY_OUT.
s3() {
  local method="$1" path="$2" query="$3" out="$4" upload="${5:-}" payload="${6:-$EMPTY_SHA256}"
  local url="${SCHEME}://${HOSTNAME_ONLY}${PORT:+:$PORT}${path}${query:+?$query}"
  local args=(--silent --show-error --connect-timeout 10 --max-time 60
    --retry 2 --retry-delay 3
    -H "x-amz-content-sha256: ${payload}"
    -D "$WORK/headers" -o "$out" -w '%{http_code}')
  case "$method" in
    PUT) args+=(--max-time 600 -T "$upload") ;;
    HEAD) args+=(--head) ;;
    GET) ;;
    *) args+=(-X "$method") ;;
  esac
  if [ "$SIGNER" = "curl" ]; then
    args+=(-K "$CREDENTIALS" --aws-sigv4 "aws:amz:${REGION}:s3")
  else
    if ! python_sign "$method" "$path" "$query" "$payload" > "$WORK/signature.curlrc" 2>"$WORK/curl.err"; then
      echo "000"
      return 0
    fi
    args+=(-K "$WORK/signature.curlrc")
  fi
  : > "$WORK/headers"
  curl "${args[@]}" "$url" 2>"$WORK/curl.err" || true
}

# The S3 error code from a response body, never the body itself.
error_code() {
  python3 - "$1" <<'PY' 2>/dev/null || true
import re, sys
try:
    text = open(sys.argv[1], encoding="utf-8", errors="replace").read(65536)
except OSError:
    text = ""
match = re.search(r"<Code>([A-Za-z0-9.]{1,64})</Code>", text)
print(match.group(1) if match else "")
PY
}

fail_http() {
  local action="$1" status="$2" body="${3:-}"
  local code=""
  [ -n "$body" ] && [ -f "$body" ] && code="$(error_code "$body")"
  if [ "$status" = "000" ]; then
    # The endpoint is a secret and curl's message names it: masked here.
    local detail
    detail="$(tr -d '\r' < "$WORK/curl.err" | head -n 1 | cut -c1-160)"
    warn "$action: no answer from the endpoint (${detail//$HOSTNAME_ONLY/<endpoint>})."
  else
    warn "$action: HTTP ${status}${code:+ ($code)}."
  fi
}

content_length() {
  tr -d '\r' < "$WORK/headers" | awk -F': *' 'tolower($1) == "content-length" {value = $2} END {print value}'
}

# Every strikehike/<stamp>.tar.enc key, oldest first (stamps are UTC and sort
# as text).
list_keys() {
  local token="" query status page=0
  : > "$WORK/keys"
  while :; do
    page=$((page + 1))
    if [ "$page" -gt 200 ]; then
      warn "listing did not finish after 200 pages."
      return 1
    fi
    query="list-type=2&prefix=strikehike%2F"
    [ -n "$token" ] && query="continuation-token=${token}&${query}"
    status="$(s3 GET "$LIST_PATH" "$query" "$WORK/list.xml")"
    if [ "$status" != "200" ]; then
      fail_http "listing ${PREFIX}" "$status" "$WORK/list.xml"
      return 1
    fi
    token="$(python3 - "$WORK/list.xml" "$WORK/keys" <<'PY'
import re, sys
from urllib.parse import quote
text = open(sys.argv[1], encoding="utf-8").read()
with open(sys.argv[2], "a", encoding="utf-8") as keys:
    for key in re.findall(r"<Key>([^<]*)</Key>", text):
        if re.fullmatch(r"strikehike/[A-Za-z0-9._-]+\.tar\.enc", key):
            keys.write(key + "\n")
truncated = re.search(r"<IsTruncated>\s*true\s*</IsTruncated>", text)
token = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", text)
print(quote(token.group(1), safe="-_.~") if truncated and token else "")
PY
)"
    [ -n "$token" ] || break
  done
  LC_ALL=C sort -u -o "$WORK/keys" "$WORK/keys"
}

# --- list -------------------------------------------------------------------
if [ "$MODE" = "list" ]; then
  list_keys || exit 1
  LC_ALL=C sort -r "$WORK/keys"
  exit 0
fi

# --- fetch ------------------------------------------------------------------
if [ "$MODE" = "fetch" ]; then
  [ -n "$OUT" ] || { echo "--fetch needs --out FILE" >&2; exit 2; }
  if [ "$FETCH" = "latest" ]; then
    list_keys || exit 1
    KEY="$(tail -n 1 "$WORK/keys")"
    [ -n "$KEY" ] || { warn "no ${PREFIX}*.tar.enc object to fetch."; exit 1; }
  else
    KEY="${PREFIX}$(printf '%s' "${FETCH%.tar.enc}" | tr -c 'A-Za-z0-9._-' '-').tar.enc"
  fi
  status="$(s3 GET "${OBJECT_BASE}${KEY}" "" "$WORK/fetched")"
  if [ "$status" != "200" ]; then
    fail_http "fetching $KEY" "$status" "$WORK/fetched"
    exit 1
  fi
  expected="$(content_length)"
  actual="$(wc -c < "$WORK/fetched" | tr -d ' ')"
  if [ -n "$expected" ] && [ "$expected" != "$actual" ]; then
    warn "fetched $actual bytes of $KEY, expected $expected."
    exit 1
  fi
  cp "$WORK/fetched" "$OUT"
  echo "fetched $KEY -> $OUT ($actual bytes, still encrypted)"
  exit 0
fi

# --- upload -----------------------------------------------------------------
if [ ! -d "$SRC_ROOT" ]; then
  echo "::notice::off-host backup: no local backups in $SRC_ROOT yet; skipped."
  exit 0
fi
STAMP="$(find "$SRC_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort | tail -n 1)"
if [ -z "$STAMP" ]; then
  echo "::notice::off-host backup: no local stamp in $SRC_ROOT yet; skipped."
  exit 0
fi
KEY="${PREFIX}$(printf '%s' "$STAMP" | tr -c 'A-Za-z0-9._-' '-').tar.enc"
if [ "$SIGNER" = "curl" ]; then
  echo "off-host: signing with curl --aws-sigv4 (${SIGNER_NOTE})"
else
  echo "off-host: signing with python3 (${SIGNER_NOTE}; curl --aws-sigv4 needs 7.88.1)"
fi

# The recipient certificate: PEM text, with real or escaped (\n) newlines, or
# the PEM base64-encoded once more.
CERT="$WORK/recipient.pem"
case "$BACKUP_RECIPIENT_CERT" in
  *"-----BEGIN CERTIFICATE-----"*) printf '%b\n' "$BACKUP_RECIPIENT_CERT" > "$CERT" ;;
  *) printf '%s' "$BACKUP_RECIPIENT_CERT" | openssl base64 -d -A > "$CERT" 2>/dev/null || true ;;
esac
if ! openssl x509 -in "$CERT" -noout 2>/dev/null; then
  warn "BACKUP_RECIPIENT_CERT is not a PEM certificate."
  exit 1
fi
if ! openssl x509 -in "$CERT" -noout -text 2>/dev/null | grep -q 'rsaEncryption'; then
  warn "BACKUP_RECIPIENT_CERT must hold an RSA public key."
  exit 1
fi

status="$(s3 HEAD "${OBJECT_BASE}${KEY}" "" /dev/null)"
if [ "$status" = "200" ]; then
  echo "off-host: $KEY is already stored; not uploaded again."
elif [ "$status" != "404" ]; then
  fail_http "checking $KEY" "$status"
  exit 1
else
  ENCRYPTED="$WORK/stamp.tar.enc"
  # tar | cms: the plaintext archive exists only in the pipe.
  if ! tar -C "$SRC_ROOT" -czf - "$STAMP" \
    | openssl cms -encrypt -binary -aes-256-cbc -outform DER \
        -recip "$CERT" -keyopt rsa_padding_mode:oaep -out "$ENCRYPTED"; then
    warn "archiving or encrypting $STAMP failed."
    exit 1
  fi
  if ! openssl cms -cmsout -inform DER -in "$ENCRYPTED" -noout -print 2>/dev/null \
    | grep -q 'envelopedData'; then
    warn "the encrypted copy of $STAMP is not CMS enveloped data."
    exit 1
  fi
  SIZE="$(wc -c < "$ENCRYPTED" | tr -d ' ')"
  SHA256="$(openssl dgst -sha256 -r "$ENCRYPTED" | cut -d' ' -f1)"

  # The payload hash is signed: the bucket refuses a body that arrives altered.
  status="$(s3 PUT "${OBJECT_BASE}${KEY}" "" "$WORK/put.xml" "$ENCRYPTED" "$SHA256")"
  if [ "$status" != "200" ]; then
    fail_http "uploading $KEY" "$status" "$WORK/put.xml"
    exit 1
  fi
  status="$(s3 HEAD "${OBJECT_BASE}${KEY}" "" /dev/null)"
  stored="$(content_length)"
  if [ "$status" != "200" ] || [ "$stored" != "$SIZE" ]; then
    warn "$KEY did not verify after the upload (HEAD ${status}, ${stored:-no} bytes of ${SIZE})."
    exit 1
  fi
  echo "off-host: ${KEY} (${SIZE} bytes, encrypted, verified)"
fi

# --- retention: the newest KEEP objects ----------------------------------------
list_keys || exit 1
if ! grep -qxF "$KEY" "$WORK/keys"; then
  warn "$KEY is missing from the listing; nothing was deleted."
  exit 1
fi
TOTAL="$(wc -l < "$WORK/keys" | tr -d ' ')"
REMOVED=0
if [ "$TOTAL" -gt "$KEEP" ]; then
  while IFS= read -r old; do
    [ "$old" = "$KEY" ] && continue
    status="$(s3 DELETE "${OBJECT_BASE}${old}" "" "$WORK/delete.xml")"
    case "$status" in
      200|204) REMOVED=$((REMOVED + 1)) ;;
      *) fail_http "deleting $old" "$status" "$WORK/delete.xml"; exit 1 ;;
    esac
  done < <(head -n "$((TOTAL - KEEP))" "$WORK/keys")
fi
echo "off-host retention: $((TOTAL - REMOVED)) kept (newest ${KEEP}), ${REMOVED} removed"
