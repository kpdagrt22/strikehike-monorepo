"""A local S3-compatible stub for tests/deploy/test_backup_offsite.sh.

Standard library only. It answers the five calls scripts/backup_offsite.sh
makes, path-style (/<bucket>/<key>) or virtual-hosted (<bucket>.<host>/<key>):

    PUT    object                    store the body
    HEAD   object                    Content-Length + ETag, or 404
    GET    object                    the body, or 404
    GET    bucket?list-type=2        ListObjectsV2 (prefix, max-keys,
                                     continuation-token), pages of --page-size
    DELETE object                    204, present or not

Every request must carry an AWS Signature Version 4 that verifies against
--key-id/--secret/--region, as S3 checks it: x-amz-content-sha256 present and
signed, every x-amz-* header signed, the payload hash equal to the body's
SHA-256 (or UNSIGNED-PAYLOAD), x-amz-date within 15 minutes. A request that
fails is answered 403/400 with an S3-style XML error and stored nowhere.

    python3 s3_stub.py --root DIR --bucket B --key-id K --secret S --region R \
        --port-file FILE [--page-size N] [--log FILE]

Objects are files under DIR/<bucket>/<key>. One JSON line per request goes to
--log (method, path, status), so a test can count calls. --self-test checks
the signature code against AWS's published example and exits.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import threading
from datetime import datetime, timezone
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
UNSIGNED = "UNSIGNED-PAYLOAD"
AUTH_RE = re.compile(
    r"^AWS4-HMAC-SHA256\s+Credential=([^,\s]+),\s*SignedHeaders=([^,\s]+),\s*Signature=([0-9a-f]{64})$"
)
KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


def uri_encode(value: str) -> str:
    return quote(value, safe="-_.~")


def canonical_query(raw: str) -> str:
    if not raw:
        return ""
    pairs = []
    for part in raw.split("&"):
        if not part:
            continue
        name, _, value = part.partition("=")
        pairs.append((uri_encode(unquote(name)), uri_encode(unquote(value))))
    pairs.sort()
    return "&".join(f"{name}={value}" for name, value in pairs)


def signing_key(secret: str, date: str, region: str, service: str = "s3") -> bytes:
    key = hmac.new(f"AWS4{secret}".encode(), date.encode(), hashlib.sha256).digest()
    for part in (region, service, "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    return key


def signature(
    *,
    secret: str,
    region: str,
    method: str,
    raw_path: str,
    raw_query: str,
    headers: dict[str, list[str]],
    signed: list[str],
    payload_hash: str,
    amz_date: str,
) -> str:
    canonical_headers = "".join(
        f"{name}:{','.join(' '.join(v.split()) for v in headers.get(name, []))}\n" for name in signed
    )
    canonical_request = "\n".join(
        [
            method,
            raw_path or "/",
            canonical_query(raw_query),
            canonical_headers,
            ";".join(signed),
            payload_hash,
        ]
    )
    scope = f"{amz_date[:8]}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    key = signing_key(secret, amz_date[:8], region)
    return hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()


def self_test() -> None:
    """AWS's 'GET Object' example (Signature Calculations for the Authorization Header)."""
    got = signature(
        secret="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1",
        method="GET",
        raw_path="/test.txt",
        raw_query="",
        headers={
            "host": ["examplebucket.s3.amazonaws.com"],
            "range": ["bytes=0-9"],
            "x-amz-content-sha256": [EMPTY_SHA256],
            "x-amz-date": ["20130524T000000Z"],
        },
        signed=["host", "range", "x-amz-content-sha256", "x-amz-date"],
        payload_hash=EMPTY_SHA256,
        amz_date="20130524T000000Z",
    )
    expected = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    if got != expected:
        sys.exit(f"sigv4 self-test failed: {got}")
    print("sigv4 self-test ok")


class Stub(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, options):
        super().__init__(address, Handler)
        self.options = options
        self.log_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: Stub

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib name
        return

    # --- responses ---------------------------------------------------------
    def _record(self, status: int) -> None:
        log = self.server.options.log
        if not log:
            return
        line = json.dumps({"method": self.command, "path": self.path, "status": status})
        with self.server.log_lock, open(log, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def _send(self, status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> None:
        self._record(status)
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        if "Content-Length" not in (headers or {}):
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Date", formatdate(usegmt=True))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _error(self, status: int, code: str, message: str) -> None:
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f"<Error><Code>{code}</Code><Message>{message}</Message></Error>"
        ).encode()
        self._send(status, body, {"Content-Type": "application/xml"})

    # --- signature ---------------------------------------------------------
    def _headers(self) -> dict[str, list[str]]:
        found: dict[str, list[str]] = {}
        for name, value in self.headers.items():
            found.setdefault(name.lower(), []).append(value.strip())
        return found

    def _verify(self, body: bytes) -> bool:
        options = self.server.options
        headers = self._headers()
        match = AUTH_RE.match(" ".join(headers.get("authorization", [""])))
        if not match:
            self._error(403, "AccessDenied", "Missing or malformed AWS4-HMAC-SHA256 Authorization")
            return False
        credential, signed_raw, given = match.groups()
        parts = credential.split("/")
        if len(parts) != 5 or parts[0] != options.key_id:
            self._error(403, "InvalidAccessKeyId", "Unknown access key")
            return False
        _, date, region, service, terminal = parts
        if region != options.region or service != "s3" or terminal != "aws4_request":
            self._error(400, "AuthorizationHeaderMalformed", "Wrong credential scope")
            return False
        signed = signed_raw.split(";")
        if signed != sorted(signed) or "host" not in signed:
            self._error(403, "AccessDenied", "SignedHeaders must be sorted and include host")
            return False
        unsigned = [n for n in headers if n.startswith("x-amz-") and n not in signed]
        if unsigned:
            self._error(
                403,
                "AccessDenied",
                "There were headers present in the request which were not signed: " + ",".join(unsigned),
            )
            return False
        content_sha = (headers.get("x-amz-content-sha256") or [""])[0]
        if not content_sha:
            self._error(400, "InvalidRequest", "Missing required header for this request: x-amz-content-sha256")
            return False
        if content_sha != UNSIGNED and content_sha != hashlib.sha256(body).hexdigest():
            self._error(400, "XAmzContentSHA256Mismatch", "The provided x-amz-content-sha256 does not match")
            return False
        amz_date = (headers.get("x-amz-date") or [""])[0]
        try:
            moment = datetime.strptime(amz_date, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            self._error(403, "AccessDenied", "Bad x-amz-date")
            return False
        if amz_date[:8] != date or abs((datetime.now(timezone.utc) - moment).total_seconds()) > 900:
            self._error(403, "RequestTimeTooSkewed", "x-amz-date is outside the allowed window")
            return False
        raw_path, _, raw_query = self.path.partition("?")
        expected = signature(
            secret=options.secret,
            region=options.region,
            method=self.command,
            raw_path=raw_path,
            raw_query=raw_query,
            headers=headers,
            signed=signed,
            payload_hash=content_sha,
            amz_date=amz_date,
        )
        if not hmac.compare_digest(expected, given):
            self._error(403, "SignatureDoesNotMatch", "The request signature we calculated does not match")
            return False
        return True

    # --- routing -----------------------------------------------------------
    def _target(self) -> tuple[str, str]:
        """(bucket, key) for path-style or virtual-hosted requests."""
        raw_path = self.path.partition("?")[0]
        host = (self.headers.get("Host") or "").split(":")[0]
        bucket = self.server.options.bucket
        if host.startswith(f"{bucket}."):
            return bucket, unquote(raw_path.lstrip("/"))
        first, _, key = raw_path.lstrip("/").partition("/")
        return unquote(first), unquote(key)

    def _object_path(self, key: str) -> Path | None:
        if not KEY_RE.match(key) or ".." in key.split("/"):
            return None
        return Path(self.server.options.root) / self.server.options.bucket / key

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _dispatch(self) -> None:
        body = self._body()
        if not self._verify(body):
            return
        bucket, key = self._target()
        if bucket != self.server.options.bucket:
            self._error(404, "NoSuchBucket", "The specified bucket does not exist")
            return
        if not key:
            if self.command == "GET":
                self._list()
                return
            self._error(405, "MethodNotAllowed", "Bucket operations other than list are not stubbed")
            return
        path = self._object_path(key)
        if path is None:
            self._error(400, "InvalidObjectName", "Key outside the stub's safe set")
            return
        if self.command == "PUT":
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".partial")
            tmp.write_bytes(body)
            os.replace(tmp, path)
            self._send(200, b"", {"ETag": f'"{hashlib.md5(body).hexdigest()}"'})
        elif self.command in ("GET", "HEAD"):
            if not path.is_file():
                if self.command == "HEAD":
                    self._send(404)
                else:
                    self._error(404, "NoSuchKey", "The specified key does not exist.")
                return
            data = path.read_bytes()
            self._send(
                200,
                data,
                {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(len(data)),
                    "ETag": f'"{hashlib.md5(data).hexdigest()}"',
                },
            )
        elif self.command == "DELETE":
            if path.is_file():
                path.unlink()
            self._send(204)
        else:
            self._error(405, "MethodNotAllowed", "Not stubbed")

    def _list(self) -> None:
        params: dict[str, str] = {}
        for part in self.path.partition("?")[2].split("&"):
            if part:
                name, _, value = part.partition("=")
                params[unquote(name)] = unquote(value)
        if params.get("list-type") != "2":
            self._error(400, "InvalidArgument", "Only ListObjectsV2 is stubbed")
            return
        prefix = params.get("prefix", "")
        page = min(int(params.get("max-keys", "1000")), self.server.options.page_size)
        start = params.get("continuation-token", "")
        root = Path(self.server.options.root) / self.server.options.bucket
        keys = sorted(
            p.relative_to(root).as_posix()
            for p in root.rglob("*")
            if p.is_file() and not p.name.endswith(".partial")
        ) if root.exists() else []
        keys = [k for k in keys if k.startswith(prefix) and (not start or k > start)]
        chunk, more = keys[:page], len(keys) > page
        items = "".join(
            f"<Contents><Key>{k}</Key><Size>{(root / k).stat().st_size}</Size>"
            f"<LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>"
            for k in chunk
        )
        token = f"<NextContinuationToken>{chunk[-1]}</NextContinuationToken>" if more else ""
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<Name>{self.server.options.bucket}</Name><Prefix>{prefix}</Prefix>"
            f"<KeyCount>{len(chunk)}</KeyCount><MaxKeys>{page}</MaxKeys>"
            f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>{token}{items}"
            "</ListBucketResult>"
        ).encode()
        self._send(200, body, {"Content-Type": "application/xml"})

    do_PUT = do_GET = do_HEAD = do_DELETE = do_POST = _dispatch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--root")
    parser.add_argument("--bucket")
    parser.add_argument("--key-id")
    parser.add_argument("--secret")
    parser.add_argument("--region")
    parser.add_argument("--port-file")
    parser.add_argument("--page-size", type=int, default=1000)
    parser.add_argument("--log")
    options = parser.parse_args()
    if options.self_test:
        self_test()
        return
    server = Stub(("127.0.0.1", 0), options)
    Path(options.port_file).write_text(str(server.server_address[1]), encoding="utf-8")
    server.serve_forever()


if __name__ == "__main__":
    main()
