# RideOffer Copilot (Android)

A copilot for Uber/Lyft drivers in the DC metro. Tap **Start Watching** before going online. The app reads each ride-offer card on screen with on-device OCR and grades it with your own cost and threshold settings. On top of the driver app it shows **two big numbers, the ride's net pay per hour and per mile ("$36/hr · 68¢/mi")**, with a GREAT / OK / BAD verdict and a one-line reason underneath. Every offer and every wait between offers is saved to a local history.

- Package: `com.rideoffercopilot.android` · Android 10+ (minSdk 29)
- Expo SDK 54 · React Native 0.81 (New Architecture) · TypeScript · one local Expo native module in Kotlin
- No Accessibility Service, no ads, no analytics, no network unless you turn on Sync

---

## What's new in versionCode 12 (field-test fixes)

Three defects from field testing are fixed, and nothing else changed. The grading engine (`src/engine/*`) is byte-identical to vc11.

1. **Verdict timing: shown while the card is up, gone when it goes.**
   *Root cause, in the code:* the native layer had no idea whether the offer card was still on screen. The verdict lived on a fixed timer (`durationMs`) that had nothing to do with the card. Nothing stopped a verdict that reached the overlay late from being drawn after its card had closed. Detection also waited on the 600 ms cadence and the static-frame skip (up to 2.5 s) even when a card was half-way in.
   *Fix:*
   - Every emitted card gets a `cardSeq` (`CardPresence.kt`). JS sends it back with the verdict, and `OverlayController` draws a verdict only while that card is still the active one.
   - While a card is up, frames are grabbed every 150 ms and compared with a luminance snapshot of the card's box (no OCR; our own overlay area is excluded). When most of the box changes, the card is gone: its verdict is removed at once (`hideForCard`, posted to the front of the main queue), and the next frame is read for a new card. The design target is 150 to 300 ms from card to clear. This has not been measured on a phone yet (see §9).
   - While a card is up, OCR only re-confirms it every 3 s (by its lower part: Accept/Match or a time+distance line), so OCR cannot hold up the gone-check.
   - A card that is still sliding in (fare plus a metric or Accept already readable) is read again on the next frame, without waiting for the normal cadence.
   - A card caught mid-slide-out is not re-emitted for 1.5 s, so the verdict does not flash back.
   - If native re-emits a card JS has already logged (for example after a false "gone"), its verdict is shown again for the new `cardSeq`. It is still never logged twice.
   - The idle cadence (600 ms) and the overlay seconds setting are unchanged. Previews (Try the grader, Settings) have no `cardSeq` and behave as before.
2. **Double-counted trip (parser).** A total line that OCR does not label "Total" on the same line (`22 min / 7.8 mi`) was taken for the pickup leg, so the trip was added on top of it (graded 39 min / 14.5 mi). `inferTotalLine()` in `src/ocr/parser.ts` now recognises the total line when (1) "Total" is on its own line next to it, (2) it equals pickup + trip, (3) both legs are labelled and it is the remaining line, or (4) it sits above a labelled trip line and is longer than that trip, with a believable pickup left over. The legs are then read normally, and a missing leg is filled from total − other leg. Every existing card parses exactly as before.
   *Regression fixture* `VC12_TOTAL_LINE_CARD` (`tests/fixtures.ts`, tests in `tests/v12.test.ts`): it grades on 22 min / 7.8 mi, net $5.79, $15.79/hr ($15.8 stored to 0.1, "$16/hr" on the overlay), $0.74/mi → **BAD**. Three OCR variants of the same card grade the same way.
3. **Rider rating on the overlay.** JS already sent `rating` ("★ 4.94"), but `OverlayController.kt` never drew it. It is now a chip next to the verdict pill, and it is left out when the card shows no rating.

Version: `versionCode 12` in `app.json` and as the signing-plugin default. Tests: 73 (66 from vc11 + 7 new).

---

## What's new in versionCode 11

1. **Verdict floats on the offer card.** The native layer already reports where the card sits on screen (`cardTop`/`cardBottom`); the overlay now anchors to the card's top edge, keeps the bottom ~84 dp (Accept) uncovered, and sits just above a card that is too short. While it covers the fare, the card is tracked by its lower part, and the verdict disappears as soon as the card does. Settings → Overlay → Position: **On the offer** (new default), Top, Middle. Drivers who had the old default "Top" are moved to "On the offer" once; "Middle" is kept.
2. **Start Watching, step 1 of 2: Display over other apps.** A plain-language screen with a preview of the overlay on a card, an **Open system setting** button (`ACTION_MANAGE_OVERLAY_PERMISSION`), and it updates itself when you come back. Step 2 is Android's screen-capture prompt.
3. **Offer details** shows every parsed field: pay (fare, bonus/surge when present, total), pickup / trip / total distance and time with a proportional bar, dead-zone return, rider star rating, the rate math (with the cost per mi/km actually used), ride, places and read quality.
4. **Rider rating** is parsed in more layouts (`4,93 ★`, Arabic digits), stored with the offer, shown on the overlay, History and details. A test runs real cards through record → CSV → JSON export → sync batch and fails if a name appears anywhere. Name stripping now also covers accented Latin names (Zoë, José) and Arabic-script names.
5. **Distances: pickup / trip / total.** `totalMi`/`totalMin` = pickup + trip, stored per offer (DB migration v2 back-fills old rows). Every rate and the verdict use the total (plus the dead-zone return when it applies). A card "Total" line is read separately; it fills in a missing leg, and a card that only shows a total is graded on it.
6. **International.** Currency is detected from the card ($, US$, CA$, €, £, E£/EGP/ج.م, SAR, AED, ₹, R$, zł, ₺ …, before or after the amount); km is converted to miles internally; decimal commas (`12,50`, `1.234,50`) and Arabic-Indic digits (`١٢٫٥٠`) are read. Settings → Market and currency: home market (23 markets), auto-detect, and editable per-market cost and GREAT/BAD thresholds in that market's currency and unit. US defaults are unchanged (GREAT ≥ $1.25/mi and ≥ $30/hr; BAD < $0.80/mi or < $18/hr); other markets start from those converted at approximate exchange rates (`src/engine/market.ts`, `perUsd`), rounded to two significant figures. Treat them as starting points.
7. **Design.** Rebuilt dark theme (layered surfaces, hairline borders, one accent, verdict colours reserved for verdicts), new tab icons, readiness checklist on Watch, refreshed overlay card (rating chip, total line).

Version: `versionCode 11` in `app.json` and as the default in the Gradle file / signing plugin. `ROC_VERSION_CODE` (CI run number) and EAS remote auto-increment still override it, as before. `versionName` stays 1.0.0.

---

## 1. Build and run

```bash
npm install
npx expo install --fix          # aligns Expo package patch versions with the SDK
npm run verify                  # typecheck + 73 unit tests + network/privacy audit
npx expo run:android            # dev build on a USB-connected phone (needs Android SDK + JDK 17)
```

The app uses a custom native module, so **it does not run in Expo Go.** Use a development build (`expo run:android`) or an EAS build.

### AAB for Google Play internal testing

**EAS (recommended)**
1. `npx eas init` writes your project ID into `app.json` (it replaces `REPLACE_WITH_YOUR_EAS_PROJECT_ID`).
2. `npm run build:aab`. EAS creates and stores the upload keystore on the first build.
3. Google requires the **first** AAB of a new app to be uploaded by hand in Play Console (Testing → Internal testing). After that, `npm run submit:internal` or the GitHub workflow can submit automatically.

**GitHub Actions** (`.github/workflows/`)
- `ci.yml` runs on every push and PR: typecheck, unit tests, network audit, then `expo prebuild` + `gradlew assembleDebug`, which proves the Kotlin module compiles. The debug APK is uploaded as an artifact.
- `release-aab.yml` runs on tags `v*` or by hand, in one of two modes:
  - `eas`: needs secrets `EXPO_TOKEN` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Builds, then submits to the internal track.
  - `gradle`: builds on the runner and signs with your upload key. Needs `UPLOAD_KEYSTORE_BASE64`, `UPLOAD_STORE_PASSWORD`, `UPLOAD_KEY_ALIAS`, `UPLOAD_KEY_PASSWORD` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Signing and versionCode are injected by `plugins/withReleaseSigning.js`.

---

## 2. Architecture

```
┌──────────────────────── Kotlin (modules/screen-watcher) ────────────────────────┐
│ ScreenWatcherModule ── consent dialog (MediaProjection) ─► ScreenWatchService     │
│   (Expo module API)                                       FGS type=mediaProjection│
│                                                           VirtualDisplay→ImageReader
│                                                           every ~600 ms:          │
│ OverlayController ◄── showOverlay()        FrameProcessor: diff-skip → ML Kit OCR │
│ (TYPE_APPLICATION_OVERLAY,                  → ignore text under our overlay       │
│  not touchable, auto-dismiss)               → OfferDetector: is this an offer card?│
│                                             → crop card → upscale → OCR again     │
│                                             → emit onCard {lines+boxes, text}     │
│                                             → emit onScreenState offer/trip/idle  │
└─────────────────────────────────────▲───────────────┬───────────────────────────┘
                                      │ overlay       │ events (text only, never pixels)
┌──────────────────────────── TypeScript (src/) ──────▼───────────────────────────┐
│ state/watchController  card → ocr/parser (privacy strip → region read → fallback │
│                        scan) → engine/grading → overlay FIRST → db/insert →      │
│                        engine/waitTracker → sync kick (only if Sync is on)       │
│ db/database (expo-sqlite)   sync/syncService → net/transport (ONLY network file) │
│ ui/ (custom router, dark design system, 8 screens)   export/ (CSV, JSON, share)  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Why the split.** Kotlin does the work that must be native and fast: capture, OCR, card detection, cropping and the overlay window. All decisions (parsing, grading, privacy, waits, storage) are pure TypeScript in `src/engine`, `src/ocr` and `src/privacy`. Those folders have no React Native imports, so they are unit-tested in plain Node (`tests/`, 73 tests).

**Latency.** The overlay is drawn before the offer is written to SQLite, so storage and sync can never delay the verdict. Card detection runs on the full frame. Only a new card triggers the second OCR pass on the crop. Identical frames skip OCR entirely.

**Card detection** (`OfferDetector.kt`) looks for a headline `$xx.xx`, at least one `N min … N.N mi` pair, and either an Accept/Match button or a second time+distance pair. The card box runs from just above the fare to the Accept button. A duplicate card (same fare, OCR jitter) is suppressed natively for 20 s and again in JS for 25 s.

### Folder map
| Path | What |
|---|---|
| `modules/screen-watcher/android/.../ScreenWatcherModule.kt` | JS API, consent flow, promise handling |
| `.../ScreenWatchService.kt` | Foreground service, projection lifecycle, frame loop, rotation |
| `.../FrameProcessor.kt`, `OfferDetector.kt` | OCR, card detection and crop, screen state |
| `.../OverlayController.kt` | Verdict window over other apps |
| `src/ocr/parser.ts` | Primary region read + fallback pattern scan, plausibility, confidence |
| `src/privacy/sanitize.ts` | Rider-name stripping |
| `src/engine/grading.ts`, `zones.ts`, `waitTracker.ts` | Grading math, zones, wait state machine |
| `src/net/networkGate.ts`, `transport.ts`, `scripts/audit-network.mjs` | Zero-network guarantee |
| `src/db/database.ts` | SQLite schema, migrations, queries |
| `src/ui/` | Screens, components, theme, router |
| `plugins/` | Manifest privacy hardening, CI release signing |

---

### Overlay design: numbers first

The overlay copies how drivers actually judge an offer out loud: "$36 an hour, 68 cents a mile."

```
┌──────────────────────────────────────────┐   background = verdict colour
│ NET / HOUR            NET / MILE         │   small labels, so it's clear these are net
│ $36/hr                68¢/mi             │   the two huge headline numbers (auto-shrink to fit)
│ ──────────────────────────────────────── │
│ [ OK ]  Fair ride: per-mile below Great  │   verdict pill + short reason support the numbers
│ Hot-zone dropoff (Arlington)             │   optional flags
└──────────────────────────────────────────┘
```

- **Hourly first, then per mile.** Both are **net**: after your per-mile car cost, with the pickup leg and any dead-zone return included.
- **Per-mile format:** under $1 it shows in cents ("68¢/mi"); from $1 up in dollars ("$1.42/mi"). Losses show a minus sign.
- **Colour:** the verdict still colours the whole card, so the tier reads instantly even though the numbers lead.
- **Unreadable card:** the overlay shows "—" for both numbers and a grey CHECK. It never shows a guessed number.
- **The same layout appears in the app:** the Watch screen's latest offer, offer details, history rows (with $/hr listed first) and *Try the grader*.
- **Code:** `buildOverlay()` in `src/engine/overlay.ts` (unit-tested), drawn by `OverlayController.kt`.

## 3. Permission flow (no crash on grant, deny or re-grant)

1. **First run:** a 4-step intro explains screen capture and the overlay in plain words, with a button that opens the overlay setting.
2. **Start Watching:**
   - If the overlay is off, the app opens an explanation screen. From there the driver can open the setting or choose **Watch without overlay** (offers are still graded and saved).
   - Android 13+ asks for notification permission (non-blocking).
   - The MediaProjection consent dialog opens. On Android 14+ it is created with `createConfigForDefaultDisplay()`, which removes the "single app" option. A single-app share would never see the Uber app.
3. **Results.** `startWatching()` never rejects. It always resolves `{granted, reason}`:
   - *Deny:* `denied` opens the "Screen capture wasn't allowed" screen with **Try again**.
   - *Grant:* the service calls `startForeground(type=mediaProjection)` first, then `getMediaProjection`, then registers the callback, then creates the virtual display (the order Android 14 requires). The promise resolves only once capture is actually running. A 10 s timeout covers that attempt only.
   - *Re-grant while watching:* the old projection is torn down on its own thread before the new one starts. A denied re-grant leaves the running session untouched.
   - *A second tap while the dialog is open:* the first request resolves as `superseded`.
4. **Stops from outside the app:** the notification's "Stop watching" button, the system "Stop sharing" chip, screen lock (newer Android), the app being swiped away, or a capture failure. Each one emits `onWatchStopped(reason)`, closes the session and open wait cleanly, and shows a plain-English notice on the Watch screen. When the app returns to the foreground, it re-checks that the service is still running.
5. **No native module** (Expo Go) or **Android < 10:** an explanatory "not available" screen. Every native call is wrapped and degrades to a safe default.

---

## 4. Grading math (defaults tuned for DC metro / Fairfax)

```
total   = fare (+ separate "+$X" bonus if shown and not marked "included")
effMi   = pickupMi + tripMi   (+ 8 mi  if the dropoff is a dead zone)
effMin  = pickupMin + tripMin (+ 25 min if the dropoff is a dead zone)
cost    = costPerMile × effMi
net     = total − cost
net/mi  = net / effMi              net/hr = net / (effMin / 60)
(gross/mi and gross/hr are also computed and stored)

GREAT ⇔ net/hr ≥ $30  AND net/mi ≥ $1.25
BAD   ⇔ net/hr < $18  OR  net/mi < 80¢
OK    otherwise
```

The two net figures are the overlay's headline numbers. The verdict and reason explain them. When both floors are missed, the reason names the hourly one first (e.g. "Net $15/hr is under your $18/hr floor").

**Why these choices**
- **The pickup leg is included.** You drive those miles and spend those minutes unpaid. A $12 trip with a 15-minute pickup is a different ride than the card's trip line suggests.
- **Cost per mile is $0.30 (marginal cost), not the IRS rate (~$0.70).** For a take-it-or-leave-it decision, only the costs that this ride causes count: fuel, tires, maintenance and mileage depreciation. Insurance and car payments are paid either way. Raise the setting for an XL/SUV.
- **GREAT needs both rates; BAD needs only one.** A ride that pays well per mile but crawls through Beltway traffic is not great, and neither is one that pays well per hour but burns 40 miles.
- **Dead-zone penalty.** A drop in Warrenton or Front Royal means about 25 minutes and 8 miles before you are back where requests come in. Adding that to the effective totals turns "$40 for 45 minutes" into an honest number. Whenever the penalty applies, the reason starts with **"Dead-zone dropoff: \<place\>"**.
- **Zones** are editable keyword lists matched as whole words against the dropoff text. The longest match wins, so "Washington Dulles" (neutral) beats "Washington" (hot). Ties go dead > hot > neutral, so a penalty is never missed. The seed lists cover hot areas (Arlington/Rosslyn/Clarendon/Ballston, Tysons, DC core, Bethesda, DCA/National Landing), neutral areas (Fairfax, Reston, Herndon, Alexandria, Dulles and others) and dead exurbs (Warrenton, Culpeper, Front Royal, Winchester, Purcellville, Fredericksburg and others).
- **Flags** appear under the reason but don't change the tier: long trip (≥45 min or ≥30 mi), long pickup (≥12 min), multi-stop, shared ride, rider rating < 4.70, hot-zone dropoff, and estimated values.
- **Missing data:** no fare means a **CHECK** verdict (grey). If only trip miles or only trip minutes was read, the other is estimated at 22 mph and flagged.

Every number above is configurable in Settings. Settings → *Try the grader* lets you type an offer or run sample cards through the real parser, grader and overlay.

---

## 5. Extraction: two paths

1. **Primary (fixed card regions).** OCR lines arrive with boxes normalized to the card. A per-platform template splits the card into a header band (fare, bonus, ride type, rating), a pickup band and a trip band. Each field is read only from its band. The area text is the line or two after each time+distance line.
2. **Fallback (whole-card pattern scan).** Any field that came back empty or implausible is read again from the full card text. The scan uses keywords ("away/pickup" vs "trip"), reading order, and "total − pickup" arithmetic.

Plausibility checks include fare $2.50–$800, pickup ≤ 30 mi, and speed 3–85 mph for the trip (catches "13.6" misread as "136"). Each offer stores `readPath` (`primary` or `fallback`), the list of `fallbackFields`, a 0–1 `confidence`, and which OCR pass produced it (a crop pass, or the full-frame pass as backup). OCR fix-ups handle common confusions such as `S12.50 → $12.50`, `rnin → min` and `1 hr 5 min`.

---

## 6. Privacy (hard rules, enforced in code)

- **Rider names are stripped before parsing** (`src/privacy/sanitize.ts`). That covers names next to a rating ("Sarah ★ 4.95"), lone name lines next to the rating, context phrases ("Picking up Michael", "Rider: Chen"), and possessives ("Aisha's trip"). Once a name is found, it is removed everywhere on the card and replaced with `[rider]`. Zone keywords and card vocabulary are protected. Names therefore never reach areas, raw text, SQLite, exports or sync. Unit tests cover this.
- Locations are stored only as the area/address text shown on the card. The app has no location permission; it is blocked in `app.json`.
- OCR is on-device (bundled ML Kit model, no model download). Frames are never saved; each bitmap is recycled after OCR.
- `android:allowBackup="false"`, so history is not copied to cloud backup.

### "Sync OFF ⇒ zero network calls": how it is provable
1. **Structure.** `src/net/transport.ts` is the only file that calls `fetch`. Only `src/sync/syncService.ts` imports it, and every sync entry point returns early when Sync is off. The sync timer is never created while it is off.
2. **Static audit** (`npm run audit:network`, run in CI). The build fails if `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or an HTTP library appears anywhere else in `src/` or `modules/`, if Kotlin code uses `HttpURLConnection`, OkHttp or sockets, if an analytics/ads/updates/accessibility dependency is added, or if anything else imports the transport. ESLint `no-restricted-globals` enforces the same rule in editors.
3. **Runtime gate.** `index.ts` imports `src/net/installGate.ts` before anything else. It replaces global `fetch`, `XMLHttpRequest.open` and `WebSocket`. Every request is refused unless Sync is on **and** the URL is exactly `https://{baseUrl}/api/rideoffer/v1/ingest`. This also stops third-party JS code from phoning home. The policy fails closed, and tests prove it. Dev builds additionally allow LAN/localhost so Metro works; release builds do not.
4. **Native.** The app's Kotlin code has no networking. ML Kit's built-in telemetry uploader is disabled by removing its `TransportBackendDiscovery` service from the merged manifest (`plugins/withPrivacyHardening.js`). Release builds have no Metro, no `expo-updates` and no dev client.

**Sync protocol (when enabled):**
- Every 2 minutes, and 8 s after each new record, the app sends the oldest unsynced offers and waits (at most 200 combined) as JSON: `POST {baseUrl}/api/rideoffer/v1/ingest` with header `X-Driver-Key`.
- HTTP 200 marks the batch synced, and a backlog drains batch by batch.
- HTTP 401 shows **"Key rejected"** in Settings and on the Watch screen, and pauses automatic retries until the key changes. *Sync now* still works.
- Any other failure leaves the records queued. Grading never waits on sync.

---

## 7. Logging and waits

- **SQLite tables:** `offers`, `waits`, `sessions`, `zones` and `kv`, with versioned migrations.
- **Each offer stores:** timestamp, platform, every extracted field, sanitized raw OCR text, total/cost/net, gross and net rates, effective miles and minutes, zone, verdict, reason, flags, confidence, read path, fallback fields and synced flag.
- **Wait records** come from a state machine (`waitTracker.ts`) driven by native screen-state events (offer / on-trip / idle), which come from on-screen keywords.
  - A wait starts when you go online, on drop-off (on-trip → idle) or when an offer is declined/expires (offer → idle).
  - It ends at the next offer, when a trip starts, or when you stop watching.
  - The zone text is the last accepted trip's dropoff area.
  - A new offer during a trip does not end the trip.
- **History screen:** filter by Today, Last session or All time. It shows totals (offers, tier counts, average net $/mi and $/hr, total offered, total and average wait), the offer list with per-offer detail (including the full math and the raw text), and the wait list. Exports are offers CSV, waits CSV and everything as JSON; CSV cells are protected against formula injection.

---

## 8. Google Play notes

- **Foreground service type `mediaProjection`** must be declared in Play Console (App content → Foreground service permissions), with a short video of Start Watching → consent → the overlay over a driver app.
- **SYSTEM_ALERT_WINDOW** is used only for the verdict card, which never intercepts touches.
- **No Accessibility Service** is declared anywhere; the audit fails the build if one appears.
- **Data safety form:** no data collected or shared by default. If Sync is enabled, data goes only to the server the user configures.
- **Privacy policy:** `PRIVACY_POLICY.md` is ready to host.
- Not affiliated with Uber or Lyft. Driver apps may change their card layouts, so treat the templates and keywords as tunable.

---

## 9. What still needs on-device testing (honest list)

I could not run an Android device or emulator, or compile Kotlin, in the build environment. The TypeScript engine is covered by 73 passing unit tests. The items below need checking on a real phone before rollout; CI's `android-compile` job checks the native code compiles.

1. **Real Uber Driver and Lyft Driver cards.** The parser was built from typical card layouts (fixtures in `tests/fixtures.ts`). Capture real cards with the app's own History → raw text view, then tune `TEMPLATES`, the fixtures and the keywords in `OfferDetector.kt`.
2. **FLAG_SECURE.** If a driver app marks its offer screen as secure, Android returns black frames to every screen recorder and nothing can be read. Check this first. Every card would then log nothing, and there is no allowed workaround.
3. **Consent flow on Android 10, 13, 14 and 15+:** grant, deny, re-grant, "Stop sharing" from the status-bar chip, screen lock, and rotation.
4. **Background JS.** Grading runs in the app's JS runtime while the foreground service keeps the process alive. Verify on aggressive OEM builds (Samsung, Xiaomi) that events keep flowing with the app in the background for an hour or more. Battery-optimization exemption may be needed on some phones.
5. **Overlay latency and readability** in sunlight at arm's length: check that the two headline numbers read in one glance and that auto-shrink keeps "$1.42/mi" on one line on narrow phones. Also check its position against each app's card. Switch Top/Middle in Settings if it covers something important.
6. **Self-read exclusion.** Confirm the OCR never re-reads the overlay (its screen rectangle is excluded, with a 1.5 s tail).
7. **Wait-state keywords** ("Complete trip", "You're online", "Finding trips" and so on) on the current app versions.
8. **Battery and heat** over a full shift. Tune `FRAME_INTERVAL_MS` (600 ms) and the capture resolution (≤1080 px short edge) if needed.
9. **Zero-network proof on device.** Run a shift with Sync off under PCAPdroid or Android's per-app data usage and confirm zero bytes.
10. **The first Play upload** (manual) and the foreground-service declaration review.
11. **On-card overlay placement** on several screen sizes for both Uber and Lyft cards: it should cover the card's top, never the Accept button, and leave when the card leaves (accept, decline, timeout).
12. **vc12 timing on real cards.** Time card-on to verdict (target ≤ 2 s) and card-off to clear (target ≤ 0.5 s) for Uber and Lyft, both on accept, decline and timeout. If the verdict drops while the card is still up, or stays after it goes, tune `CELL_CHANGE` (40) and `GONE_FRACTION` (0.5) in `FrameProcessor.kt`.
13. **Arabic-script cards.** The bundled ML Kit recognizer reads Latin script only. Cards that use Western digits and Latin currency codes work; Arabic words and Arabic-Indic digits on screen will not be recognized by OCR even though the parser handles them (they work in "Try the grader" and if a future recognizer outputs them). Check a real Arabic-UI card before relying on it.
