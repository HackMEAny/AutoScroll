# Testing before a release

Two layers. CI covers the first one on every push, so a broken zip can never reach a release.
The second one needs a logged-in browser, so it is manual — run it once before each tag.

## Automated (runs in CI, no action needed)

| Check | Where |
| --- | --- |
| `manifest.json` parses, MV3, has name/version/description/16-48-128 icons | `scripts/validate.js` |
| Every icon, popup, options page, service worker, content script and CSS the manifest references exists | `scripts/validate.js` |
| Release tag matches `version` in the manifest | `scripts/validate.js` |
| Zip contains only runtime files and has `manifest.json` at its root (what "Load unpacked" needs) | `.github/workflows/ci.yml` |
| The extension actually loads: service worker starts and the popup renders as a `chrome-extension://` page | `node scripts/smoke.js chromium` / `brave` (run before tagging) |

End-to-end browser tests are not automated here on purpose: YouTube Shorts, Instagram and
Facebook all need a logged-in session and shift their DOM constantly, so a CI run would be
flaky rather than informative.

## Manual pass — P0 must be green to publish

Load the artifact from `dist/` (or the previous Release zip) with `chrome://extensions` →
Developer mode → Load unpacked.

| ID | Pri | Area | Steps | Expected |
| --- | --- | --- | --- | --- |
| TC-01 | P0 | Install | Load the zip folder, open the extensions page | Card shows ReelFlow 1.0.0, icon renders, no "Errors" button |
| TC-01b | P1 | Browser matrix | Run `node scripts/smoke.js chromium` and `node scripts/smoke.js brave` | Both print `PASS ... worker + popup ok` |
| TC-01c | P1 | Edge | Load the zip by hand in Edge | Same as TC-01 — this is the browser you publish to for free |
| TC-02 | P0 | Popup | Click the toolbar icon | Popup opens, no red errors in the popup console |
| TC-03 | P0 | YouTube | Open `youtube.com/shorts` | Each Short advances automatically at the configured delay |
| TC-04 | P0 | Instagram | Open `instagram.com/reels` | Each Reel advances automatically |
| TC-05 | P0 | Facebook | Open `facebook.com/reels` | Each Reel advances automatically |
| TC-06 | P0 | Master switch | Turn the toggle off, then open a short | No auto-advance anywhere; popup says inactive |
| TC-07 | P0 | Persistence | Set delay to 3.0s, reload the page | New delay applies; slider still at 3.0s after reopening the popup |
| TC-08 | P1 | Platform chips | Deselect Instagram, open a Reel | Instagram ignored, YouTube still scrolls |
| TC-09 | P1 | Ad skip | Watch a YouTube ad before a Short | Ad skipped, "ads skipped" count increments |
| TC-10 | P1 | Ad skip off | Turn skip-ads off, watch another ad | Ad plays normally, counter unchanged |
| TC-11 | P0 | Reel count | Watch 10 Shorts | Popup count goes up by exactly 10, never double on one video |
| TC-12 | P1 | Time tracking | Watch continuously for 5 minutes | Popup time within ±10% of 5m, no jump on tab switch |
| TC-13 | P1 | Per-platform | Use two platforms for a few minutes | Rows show time and % that add up to ~100% |
| TC-14 | P1 | Top platform badge | Use one platform clearly more | Badge names that platform, no "No data yet" |
| TC-15 | P0 | Restart | Close and reopen the browser | Stats and settings intact |
| TC-16 | P0 | Dashboard | Popup → Detailed Insights | Overview, History and Settings render with data, no console errors |
| TC-17 | P1 | Service worker | Idle 2 minutes, then watch a short | Stats still record after the MV3 worker wakes |
| TC-18 | P1 | Two tabs | Two tabs of the same platform at once | No duplicated counts; time not counted twice |
| TC-19 | P0 | Reset | Reset Stats in the popup | Popup and dashboard show zero, settings kept |
| TC-20 | P1 | Install warnings | Review the install prompt in the browser | Only storage/tabs/alarms + the three site permissions, nothing scary |
| TC-21 | P1 | Uninstall | Remove the extension | No errors left behind; reinstall starts clean |

Record the run in the release notes ("Tested: TC-01…TC-21 on Chromium x, Brave y, Edge z"). If a P0
fails, fix it and bump the patch version — do not tag over a failed build.
