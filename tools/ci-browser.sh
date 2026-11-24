#!/usr/bin/env bash
# CI-only: use the hosted runner's existing system libraries whenever possible.
set -euo pipefail
SECONDS=0
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check playwright==1.56.0 websocket-client==1.8.0
# Both distributions are required: ordinary tests use headless shell; CDP
# coverage starts the full Chromium executable. Do not change browser versions.
.venv/bin/python -m playwright install chromium

probe() {
  .venv/bin/python - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

with TemporaryDirectory(prefix="hdbms-ci-probe-") as tmp:
    path = Path(tmp, "probe.html")
    path.write_text("<!doctype html><title>Native crypto probe</title>", encoding="utf-8")
    with sync_playwright() as pw:
        for name, options in (
            ("headless shell", {}),
            ("full Chromium", {"executable_path": pw.chromium.executable_path}),
        ):
            browser = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"], **options)
            try:
                page = browser.new_page()
                page.goto(path.as_uri())
                assert page.evaluate("""async () => {
                    if (!isSecureContext || !crypto.subtle) return false;
                    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array()));
                    const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
                    const iv = new Uint8Array(12), data = new Uint8Array([42]);
                    const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
                    const pt = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct));
                    return hash[0] === 227 && pt.length === 1 && pt[0] === 42;
                }"""), "Native Web Crypto unavailable"
                print(f"CI BROWSER PROBE PASS: {name}", flush=True)
            finally:
                browser.close()
PY
}

log=$(mktemp)
trap 'rm -f "$log"' EXIT
if probe >"$log" 2>&1; then
  cat "$log"
  echo "CI BROWSER SETUP FAST PATH: existing system libraries; ${SECONDS}s"
else
  cat "$log" >&2
  # Only missing-library diagnostics warrant installing OS packages.
  if ! grep -Eqi 'Host system is missing dependencies|error while loading shared libraries|cannot open shared object file' "$log"; then
    echo 'CI BROWSER PROBE FAILED: not a missing-library diagnostic' >&2
    exit 1
  fi
  echo 'CI BROWSER SETUP FALLBACK: missing system libraries'
  .venv/bin/python -m playwright install-deps chromium
  probe
  echo "CI BROWSER SETUP FALLBACK PASS: ${SECONDS}s"
fi
