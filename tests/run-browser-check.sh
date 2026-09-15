#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
shopt -s nullglob
engines=(.example/*_files/danmaku-v2.js*)
if [ "${#engines[@]}" -ne 1 ]; then
  printf '%s\n' 'Expected one saved danmaku-v2.js file under .example/*_files/.' >&2
  exit 1
fi
mkdir -p generated
cp -- "${engines[0]}" generated/test-engine.js
pwcli() {
  if [ -n "${PWCLI:-}" ]; then
    bash "$PWCLI" "$@"
  else
    npx --yes --package @playwright/cli playwright-cli "$@"
  fi
}
pwcli -s=danmaku-qa open about:blank
trap 'pwcli -s=danmaku-qa close' EXIT
pwcli -s=danmaku-qa run-code --filename tests/browser-check.js
pwcli -s=danmaku-qa run-code --filename tests/auto-repeat-check.js
