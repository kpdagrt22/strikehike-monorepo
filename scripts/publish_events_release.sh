#!/usr/bin/env bash
# Publish one gated events bundle as the GitHub release events-bundle-<VERSION>.
# Called by the publish job of .github/workflows/events-weekly.yml.
#
# Idempotent: the version is a hash of the bundle content, so the same week
# built twice (a late cron after a manual dispatch, as on 16 Nov 2026) has the
# same version, and a complete release for it is left alone.
#
# A partial publish is never skipped: a release that exists as a draft, or
# without one of its three assets, makes the script fail. Activation would
# otherwise download a broken release on every later run of that version.
#
# Env: VERSION     bundle_version from the gated manifest
#      BUNDLE_DIR  the extracted bundle directory (holds manifest.json)
#      WORK_DIR    scratch directory for the tarball (default: RUNNER_TEMP)
#      GH_REPO, GH_TOKEN for the gh CLI
set -euo pipefail

: "${VERSION:?VERSION is required}"
: "${BUNDLE_DIR:?BUNDLE_DIR is required}"
WORK_DIR="${WORK_DIR:-${RUNNER_TEMP:?WORK_DIR or RUNNER_TEMP is required}}"

tag="events-bundle-$VERSION"
tarball_name="events-bundle-$VERSION.tar.gz"
manifest="$BUNDLE_DIR/manifest.json"
assets_expected=("$tarball_name" manifest.json SHA256SUMS)

if [ ! -f "$manifest" ]; then
  echo "::error::$manifest is missing; nothing to publish."
  exit 1
fi

# The workflow validated the manifest already; the script refuses on its own
# too, so it can never publish a bundle the gates did not pass.
python - "$manifest" "$VERSION" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
if manifest.get("bundle_version") != sys.argv[2]:
    raise SystemExit(
        f"::error::manifest bundle_version {manifest.get('bundle_version')!r} "
        f"is not {sys.argv[2]!r}; refusing to publish."
    )
if manifest.get("publishable") is not True:
    raise SystemExit("::error::manifest is not publishable; refusing to publish.")
PY

if state="$(gh release view "$tag" --json isDraft,assets \
  --jq '[(.isDraft | tostring), ([.assets[].name] | join(","))] | @tsv' 2>/dev/null)"; then
  is_draft="${state%%$'\t'*}"
  names=",${state#*$'\t'},"
  missing=()
  for name in "${assets_expected[@]}"; do
    case "$names" in
      *",$name,"*) ;;
      *) missing+=("$name") ;;
    esac
  done
  if [ "$is_draft" != "false" ] || [ "${#missing[@]}" -gt 0 ]; then
    echo "::error::Release $tag exists but is incomplete (draft: $is_draft; missing: ${missing[*]:-none})." \
      "It is never skipped or overwritten automatically: check it, delete it by hand, then re-run."
    exit 1
  fi
  echo "Release $tag already exists with all three assets; skipping."
  exit 0
fi

mkdir -p "$WORK_DIR"
tar -czf "$WORK_DIR/$tarball_name" -C "$BUNDLE_DIR" .
cp "$manifest" "$WORK_DIR/manifest.json"
cd "$WORK_DIR"
sha256sum "$tarball_name" manifest.json > SHA256SUMS
gh release create "$tag" \
  "$tarball_name" \
  manifest.json \
  SHA256SUMS \
  --title "Events bundle $VERSION" \
  --notes "Weekly events bundle $VERSION. Manifest publishable=true."
echo "Published $tag."
