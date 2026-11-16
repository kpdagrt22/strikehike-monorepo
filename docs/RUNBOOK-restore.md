# Restore on a new host

The backup stamps are directory trees: `analytics.sqlite`, `digest.sqlite`,
`historical_events.db` and `events/` (bundles + `current` pointer). A stamp is
owner-only on the host and contains subscriber emails from `digest.sqlite`.

Every deploy writes a stamp to `~/strikehike-backups/` on the host (the newest 14 are kept,
`scripts/backup_runtime.sh`) and, once the owner has set it up (below), copies the newest stamp
off the host, encrypted (`scripts/backup_offsite.sh`, the newest 30 objects are kept).

## Drill (this machine)

1. Pick a stamp: `~/strikehike-backups/<UTC stamp>`.
2. Restore into a scratch directory:
   ```
   bash scripts/restore_runtime.sh --from ~/strikehike-backups/<stamp> --to /tmp/restored
   ```
   The script refuses `--project strikehike-chrono`, runs `PRAGMA integrity_check` on every database, writes
   `restore-report.json` and compares row counts with the source.
3. Run the backend against it (no production volume):
   ```
   PYTHONPATH=src ANALYTICS_DB=/tmp/restored/analytics.sqlite \
   EVENTS_RUNTIME_DIR=/tmp/restored/events \
   HISTORICAL_EVENTS_DB=/tmp/restored/historical_events.db \
   .venv/bin/python -m uvicorn api_server:app --host 127.0.0.1 --port 8011
   ```
4. Check `/api/v1/events/upcoming` and `/api/v1/regime/macro-history` answer 200.
5. Start the stack only after the check passes.

## Total loss on a new host

1. Provision the host and install Docker + compose.
2. Clone the repository and check out the live commit.
3. Create the compose volumes; **do not** mount `caddy-data` for the restore.
4. Get the newest stamp from the off-host bucket and decrypt it on the machine that holds the private key
   ("Restore from the off-host copy" below), then copy the plaintext stamp to the host.
5. Restore into the `historical-data` volume:
   ```
   docker run --rm -v strikehike-chrono_historical-data:/data \
     -v /path/to/stamp:/backup:ro alpine sh -c 'cp -a /backup/. /data/'
   ```
6. Start the stack, then run `node scripts/verify-live.mjs --base-url=... --expect-sha=...`.
7. Compare `restore-report.json` row counts with the last known values; check `/api/v1/events/upcoming` and
   `/api/v1/regime/macro-history`.

Caddy configuration and its data are separate; this runbook never copies or mounts them.

## Off-host copies

### How it works

Right after `backup_runtime.sh`, the deploy runs `scripts/backup_offsite.sh`:

- it tars (gzip) the newest stamp and encrypts it on the host with `openssl cms` (AES-256-CBC; the session key
  is wrapped with RSA-OAEP for the owner's **public** certificate). The host never holds a key that can decrypt;
- it uploads the result to `<bucket>/strikehike/<stamp>.tar.enc` with `curl --aws-sigv4` (curl 7.88.1 or newer;
  an older curl, such as Ubuntu 22.04's 7.81, gets the same Signature Version 4 from `python3`). The payload
  hash is signed, so the bucket refuses a body that arrives altered;
- it checks the object with HEAD (status and size), then keeps the newest 30 `strikehike/*.tar.enc` objects and
  deletes older ones. Nothing is deleted unless the new upload verified;
- with any of the six settings missing it prints a notice and does nothing; any failure prints a `::warning::`
  and the deploy carries on. It never prints a secret, the endpoint or the bucket name.

Cost at today's size (a stamp is a few MB; 30 kept): a Lightsail bucket is the $1/month 5 GB plan; Backblaze B2
charges $6/TB-month with the first 10 GB free, so a few cents at most.

### Owner setup (once)

**1. Create a private bucket and a key that can reach only that bucket.** Either:

- **Backblaze B2.** *Buckets → Create a Bucket*: a unique name (for example `strikehike-backups-<random>`),
  *Files in Bucket: Private*, *Object Lock: Disabled*. Then *Lifecycle Settings → Keep only the last version of the
  file*: B2 keeps a hidden earlier version after an S3 delete, so without this rule retention does not free space.
  The bucket card shows the endpoint, `s3.<region>.backblazeb2.com` (for example `s3.us-west-004.backblazeb2.com`;
  the region is the middle part, `us-west-004`).
  *Application Keys → Add a New Application Key*: name `strikehike-deploy`, *Allow access to Bucket(s)*: this
  bucket only, *Type of Access: Read and Write*, *File name prefix*: `strikehike/`. Copy the **keyID** and
  **applicationKey** (shown once).
- **A Lightsail bucket.** *Storage → Create bucket*, in the instance's region (for example `ap-south-1`), the
  5 GB plan, versioning off. *Permissions → Access keys → Create access key*: copy the **access key ID** and the
  **secret access key** (shown once). Use the virtual-hosted endpoint `https://<bucket>.s3.<region>.amazonaws.com`.

**2. Generate the encryption keypair on your own machine, not on the host.** Git Bash on Windows includes
OpenSSL 3; `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting the `/CN=` subject into a Windows path (harmless
on Linux or macOS with OpenSSL 3):
```
mkdir -p ~/strikehike-backup-key && cd ~/strikehike-backup-key
# The private key, encrypted with a passphrase you choose (asked twice).
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -out strikehike-backup.key
# The public certificate the host encrypts for (passphrase asked once).
MSYS_NO_PATHCONV=1 openssl req -new -x509 -key strikehike-backup.key -days 3650 \
  -subj "/CN=strikehike-backup" -out strikehike-backup.crt
openssl x509 -in strikehike-backup.crt -noout -subject -enddate -fingerprint -sha256
```
The certificate's end date does not stop encryption; it is informational.

**3. Keep the private key offline.** Store `strikehike-backup.key` and its passphrase in two places you control
(for example a password-manager entry with the file attached, and a USB drive kept apart). It never goes to the
host, the repository or GitHub. Without it no copy can be decrypted; with it, every copy can. Only
`strikehike-backup.crt` is shared.

**4. Set five repository secrets and one repository variable** (Settings → Secrets and variables → Actions, or
`gh`; without `--body`, `gh secret set` asks for the value, so it stays out of the shell history):
```
REPO=kpdagrt22/strikehike-monorepo
gh secret set BACKUP_S3_ENDPOINT --repo "$REPO"   # https://s3.us-west-004.backblazeb2.com, or https://<bucket>.s3.<region>.amazonaws.com
gh secret set BACKUP_S3_BUCKET   --repo "$REPO"   # the bucket name
gh secret set BACKUP_S3_REGION   --repo "$REPO"   # us-west-004, or ap-south-1
gh secret set BACKUP_S3_KEY_ID   --repo "$REPO"   # keyID / access key ID
gh secret set BACKUP_S3_SECRET   --repo "$REPO"   # applicationKey / secret access key
gh variable set BACKUP_RECIPIENT_CERT --repo "$REPO" < ~/strikehike-backup-key/strikehike-backup.crt
```
The certificate is public, so it is a variable, not a secret.

**5. Check the next deploy.** Its log shows `off-host: signing with ...`,
`off-host: strikehike/<stamp>.tar.enc (<n> bytes, encrypted, verified)` and
`off-host retention: <n> kept (newest 30), <m> removed`. Then do the restore below once, as a drill.

To switch it off, delete `BACKUP_S3_SECRET` (or any of the six): the deploy prints a notice and skips the copy.
To change the keypair, set the new certificate; keep the old private key until the last object it encrypted has
left the newest 30.

The bucket key on the host can delete objects (retention needs it). Someone who took over the host could delete
the off-host copies but not read them. To guard against that too, use B2 Object Lock or a lifecycle rule instead
of delete rights; the retention step then warns on every deploy and deletes nothing.

### Restore from the off-host copy

1. **Download the newest object** (still encrypted): from the provider's console (B2: *Browse Files →
   strikehike/*; Lightsail: *Objects → strikehike/*), or with the script on any machine with bash, curl,
   openssl and python3 and the five `BACKUP_S3_*` values in its environment (type the secret with
   `read -rs BACKUP_S3_SECRET && export BACKUP_S3_SECRET`, so it stays out of the shell history):
   ```
   bash scripts/backup_offsite.sh --list                    # newest first
   bash scripts/backup_offsite.sh --fetch latest --out latest.tar.enc
   ```
   `--fetch <stamp>` takes one stamp from the list instead of `latest`.
2. **Decrypt on the machine that holds the private key** (asks for the passphrase):
   ```
   openssl cms -decrypt -binary -inform DER -in latest.tar.enc \
     -inkey ~/strikehike-backup-key/strikehike-backup.key \
     -recip ~/strikehike-backup-key/strikehike-backup.crt -out latest.tar.gz
   mkdir restored-stamp && tar -C restored-stamp -xzf latest.tar.gz
   ls restored-stamp/      # one <stamp>/ directory: the three databases and events/
   ```
3. **Prove it** before anything else: `bash scripts/restore_runtime.sh --from restored-stamp/<stamp> --to /tmp/restored`
   (integrity check and row counts, as in the drill above).
4. **Copy it to the host** for "Total loss" step 5, for example
   `scp -r restored-stamp/<stamp> ubuntu@<host>:~/restore-stamp`. The plaintext holds subscriber emails:
   delete `latest.tar.gz` and `restored-stamp/` locally once the restore is done.
