# Contributing & releasing ReelFlow

Everything a maintainer needs. Nothing here is required to *use* the extension — see [README](README.md).

## Project layout

```
manifest.json          MV3 manifest — the only place permissions and paths are declared
background/            service worker: storage, stats, badges
content/               auto-scroll engine + one adapter per platform
popup/                 toolbar popup (today / all-time stats, quick settings)
dashboard/             full analytics page (chart, breakdown, insights, settings)
icons/                 extension icons + the generator script
scripts/               validate.js, package.sh, shots.js, smoke.js
```

## Before you tag

1. Bump `version` in `manifest.json` (semver — the tag must match it exactly).
2. Run the automated gate: `node scripts/validate.js`
3. Load-test the real extension:
   ```sh
   node scripts/smoke.js chromium
   node scripts/smoke.js brave
   ```
   Both must print `PASS … worker + popup ok`. Branded Chrome/Edge refuse `--load-extension`
   automation (since Chrome 137), so verify those two by hand.
4. Run the manual cases in [TESTING.md](TESTING.md) — every P0 green.

## Release

```sh
git tag v1.0.1 && git push origin v1.0.1
```

The tag triggers `.github/workflows/release.yml`, which:

- fails if the tag and `manifest.json` version disagree,
- builds `reelflow-v1.0.1.zip` with `scripts/package.sh` (runtime files only, `manifest.json` at
  the root so "Load unpacked" works),
- attaches it to a GitHub Release.

`.github/workflows/ci.yml` runs on every push and PR:

- **validate** — manifest + zip layout, so a broken package can't reach a release,
- **smoke / chromium** and **smoke / brave** — loads the unpacked extension in a real browser and
  asserts the service worker starts and the popup renders.

Branded Chrome and Edge can't be driven this way (they ignore `--load-extension` since v137), which
is why the CI matrix uses unbranded Chromium and Brave instead. Test Edge by hand with TC-01c.

## Publishing to a store

**Microsoft Edge Add-ons is free** — no registration fee, and this package works unchanged.
Register at [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge), upload the zip
from the latest Release. You get a listing, search visibility and auto-updates at $0.

Opera Add-ons and Firefox AMO are also free; Firefox needs a separate MV3 build
(`background.scripts` plus a `browser_specific_settings.gecko.id`).

Google charges a one-time **$5** for a Chrome Web Store developer account and there is no way
around it. A self-hosted `.crx` is not a workaround — Chrome blocks off-store installs on Windows
and macOS (Linux only).

## Regenerating the README screenshots

They are rendered, not hand-taken:

```sh
node scripts/shots.js
```

Headless Chromium loads `popup.html` and `dashboard.html` with a stubbed `chrome.storage` holding
30 days of sample stats, then writes `docs/screenshots/popup.png` and `dashboard.png` at 2×. Re-run
it whenever the UI changes so the README never shows a stale build.

## Assets a store listing needs

- Icon: `icons/icon128.png`
- Screenshots: 1280×800 or 640×400 (the smoke/render scripts give you the pages; capture at that
  size)
- Privacy blurb: the extension makes no network requests and stores everything in
  `chrome.storage.local` — the same claim the README makes, keep them in sync.
