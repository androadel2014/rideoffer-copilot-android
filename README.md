# RideOffer Copilot Android v2.1.0 — ANY-APP LIVE OFFER WATCH (source project)

**Personal Samsung Galaxy S25 Ultra trial.** Kotlin + Jetpack Compose, English-only UI. No ads, accounts, analytics, Accessibility service, automatic tapping, or store publishing. Main experience: **start a consented LIVE screen-watch session**, switch to a work app, automatically recognize offers and see a short verdict badge. Manual screenshot import from v1 remains available.

> **Build status: SOURCE ONLY.** This project was not assembled into an APK with Android Gradle Plugin in the authoring environment; there is no Android SDK or Gradle here. Pure Kotlin smoke tests and source checks were executed, but MediaProjection, ML Kit on actual frames, overlays, notifications, battery behavior, UI compilation and Samsung installation were **not** device-tested. CI/Android Studio must verify them. See `Docs/RESULTS.md`.

## Live workflow (on the phone)

1. Install the debug APK and launch **RideOffer Copilot**. The Home page explains the permissions and displays **Start live watch**.
2. Optional: tap **Allow Usage Access** to get the foreground app name from Android usage events. MediaProjection alone cannot provide package identity; without this special access live History labels the source `Unknown app`. Optional but recommended: tap **Allow floating badge**. Android opens **Display over other apps** settings; grant permission for RideOffer Copilot and go back. Without this, the app uses verdict notifications and Home's recent-offer feed.
3. Tap **Start live watch**. On Android 13+, allow notifications if prompted (needed for heads-up verdict notifications; denying does not block capture). Android then displays its official screen-capture consent dialog. **Select “Entire screen” (rather than a single app)** and approve. Android requires fresh consent for **every** new session.
4. Switch to any supported work app, go online, and keep the screen on. The app's foreground service receives shared-screen frames, checks roughly every **2 seconds**, and runs **bundled on-device ML Kit OCR** on the full captured screen, then isolates a card-sized window around each plausible fare line. OCR is reattempted periodically even if a coarse frame hash is unchanged.
5. When a likely offer card is readable (**fare plus at least two of distance, duration, pickup/dropoff/address clue**), it is parsed and **logged automatically** once per unique offer. Complete trip offers use the unchanged NET engine; incomplete delivery cards show a conservative BORDERLINE/REVIEW label with a clearly identified $/delivery amount or gross $/hr estimate, never made-up NET rates. A green **ACCEPT**, amber **BORDERLINE**, or red **SKIP** badge shows available metrics near the **TOP** for ~5 seconds and can be dismissed by tapping it. **YELLOW/BORDERLINE is displayed as an AMBER BORDERLINE badge**, matching the persisted verdict exactly. With overlay permission denied, the app attempts a heads-up notification instead. Home shows the latest offer and recent feed.
6. Stop safely using **Stop** in the persistent foreground-service notification (or **Stop live watch** in Home). Stopping releases the projection, image buffers, recognizer, overlays, and TTS. A fresh permission prompt is needed to start again.
7. You can still choose **Grade a screenshot (manual)** or share an image from Samsung Gallery → Share → RideOffer Copilot. It uses the generic OCR parser with Uber/Lyft tuned extractors, Verdict, History, and Settings.

**Safety:** This is a read-only decision aid. It never accepts or rejects an Uber/Lyft ride for you and never touches their app. It can misread an offer, skip an offer, or show a late result; do not interact with the screen while driving. Verify important details when safely parked. The cost/threshold values are **PROVISIONAL**, not calibrated profitability advice.

## Permissions (AndroidManifest.xml)

| Permission | Purpose | Consent / consequence |
|---|---|---|
| `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Keep a visible, user-stoppable screen capture session alive | Android requires typed foreground service for Android 14+; **only launched following foreground user consent** |
| MediaProjection screen share | Receive screen frames; *no separate dangerous manifest permission* | **System prompt every session**; user must select **Entire screen** to follow work apps across apps. Android system privacy indicator appears |
| `SYSTEM_ALERT_WINDOW` | Short, dismissible floating verdict badge | **Optional** special access, requested via Android's Settings screen; without it, notification + in-app feed fallback |
| `POST_NOTIFICATIONS` | Fallback offer alerts, plus visibility/control on supported versions | Runtime permission on Android 13+; denied notifications may prevent heads-up offer alerts; Home still has status and Stop |
| `PACKAGE_USAGE_STATS` | **Optional package-name identification** from system Usage Access events; not part of MediaProjection | User must explicitly grant **Usage Access** in Settings. Without it, live rows use `Unknown app`. No Accessibility service is used |
| `INTERNET` | **Only** manually enabled HTTPS sync module | Sync OFF by default; service never executes the application's sync code |

**Not requested:** location, photo library/storage access, accessibility service, notification listener, microphone, boot-on-start, contacts, camera, or automated touch control. MediaProjection may be blocked by Android or another app's protected-content settings (`FLAG_SECURE`). On some Android versions/share dialogs the user may be offered a single-app share option; selecting only RideOffer Copilot will NOT watch other apps.

## How detection works / limits

- `LiveWatchService.kt`: foreground service (`mediaProjection` type), notification with Stop action, **one** MediaProjection → **one** virtual display per consent; resize uses `VirtualDisplay.resize()` and `.setSurface()`. Capture resolution capped at 1080 px wide; `ImageReader` frames decoded in memory, analyzed across the entire frame, throttled ~2 seconds, image processing single-flight. No saved screenshots. Pauses OCR when the display is off.
- `LiveOfferGate.kt` + `UniversalOfferDetector.kt`: a priced offer must also show at least two independent signals from distance, duration, pickup/dropoff/address. Explicit ordinary map/receipt/checkout screens without offer cues are excluded. Nearby OCR lines are grouped around each fare anchor, not blindly treated as the same card; false matches remain possible.
- `OfferParser.kt` (original tuned Uber/Lyft path, privacy sanitizer strengthened for free-form names after labels): extracts the largest leading fare (ignoring Lyft hourly-rate), pickup, trip, included bonus, rating, and address-like dropoff/pickup; sanitizes OCR text with `CardPrivacy` allow-list. The engine rejects invalid/implausible offers. **It can still produce false positives / false negatives**; no live frame from a Samsung has been calibrated yet. `SourceAppResolver.kt` uses OPTIONAL UsageStatsManager for package-based labels, falling back to `Unknown app` without permission.
- `LiveOfferDedup.kt`: numeric/address fingerprint with a 90s cooldown to avoid logging the same offer repeated across OCR frames or transient screen flickers. A changed fare/trip fingerprint logs immediately. Two offers with indistinguishable details inside 90 seconds may be treated as one; if OCR changes a number significantly, duplicates are possible.
- `LiveOverlay.kt` + `VerdictBadgeStyle.kt`: GREEN/AMBER/RED color maps to ACCEPT/BORDERLINE/SKIP; overlay near top (72 dp from top), not near the bottom Accept button. Auto-fade at ~4.6s, tap to dismiss; uses a window type allowed for user-approved overlays. If permission denied/revoked, high-priority verdict notifications are used when notifications are allowed.
- `LiveWatchState.kt`: in-process UI state for status/feed. `OfferDatabase` remains the durable source of truth. Live scanning and logging run in the **foreground service**; **sync runs only in main UI** and only if enabled.

**Latency / battery:** Capture is sampled about every two seconds, plus ML Kit OCR latency, so the verdict is **not instantaneous**. ML Kit and a screen-capture foreground service consume battery; do not assume they are free to run for a long shift until measured on the actual Galaxy. Android screen-off skips analysis; session remains active until Stop/system revocation; Android may stop capture at any time.


## v2.1.0 generic detector and platform-specific limits

**Rule:** a plausible offer needs a payable `$` amount **and any two** of (1) mileage in `mi` or `km`, (2) time in `min` or `hr`, (3) pickup/dropoff wording or an address-looking line. Candidate lines are clustered around a fare OCR anchor, and ordinary `Map`/`Checkout`/`Receipt` pages are excluded unless an explicit work-offer cue appears. This is a text heuristic, not a guarantee that any onscreen money represents earnings. The app scans the captured *whole* frame and uses no Accessibility APIs.

| Work app | Tuned OCR cue / parsing path | What can be graded | Important limitation |
|---|---|---|---|
| **Uber Driver** | UberX, UberXL, Match; original `OfferParser` | Pickup + trip, including long-return/dead-zone, provisional net thresholds | Layout changes, surge fields, maps, OCR can mislead |
| **Lyft Driver** | Lyft, Comfort, Incl. bonus; original `OfferParser` | Same trip NET rules, bonus not counted twice | Hourly estimate isn't the fare |
| **DoorDash Dasher** | DoorDash, Dasher; generic pay + route-mile + duration extraction | NET if both miles and minutes exist; missing metrics -> BORDERLINE | Total delivery time often **not** displayed; optional time can be only an estimate |
| **Instacart Shopper** | Instacart, Batch; generic pay + distance + duration | NET only when route mileage and total estimated time are actually shown | Shopping/picking time may not be complete; tip amounts can change |
| **Amazon Flex** | Amazon Flex, block / station | If duration but no distance: **gross $/hr est. (NOT NET)**, always BORDERLINE | Many block offers omit route miles; a block is not one completed delivery |
| **Walmart Spark** | Spark Driver / Walmart Spark; pay / distance / destination | If distance but no duration: **$/delivery only**, always BORDERLINE | Shop/dropoff durations, tips, and route totals may be unavailable |
| **Any other app** | Universal money + evidence rule; no brand required | NET only with both estimated distance **and** duration; else conservative partial result | No tuned layouts; highest risk of false positives/incorrect numbers |

**Metric honesty:** An incomplete card is retained with `metricMode` (`gross_hour_estimate` or `per_delivery`) and `hasTripMiles` / `hasTripMinutes`; missing trip and NET fields serialize as JSON `null` (blank in CSV) rather than invented zero miles/hours. The memory model uses zeros solely as internal placeholders guarded by these flags. `grossHourlyEstimate` is the card's fare divided by displayed time and is explicitly **before unknown operating cost**. Full trip rows continue to use the unchanged `DecisionEngine`. Added fields are optional so old SQLite JSON records still deserialize. Existing CSV columns remain in order; two new columns are appended.

**App identity:** the original screen-share API contains pixels, not an application package. The additional `PACKAGE_USAGE_STATS` special access is optional and is requested through Android Settings, not silently granted. When available, a `UsageStatsManager` foreground-resume event supplies a package; known IDs map to Uber, Lyft, DoorDash, Instacart, Amazon Flex or Walmart Spark; otherwise the installed app's readable launcher label is used if Android permits querying it. Without evidence, live records use **`Unknown app`**. A manual imported image can infer a brand from its OCR but cannot prove which app produced it. Usage events and raw package IDs are not stored/synced. During system dialogs or overlapping windows, package attribution may temporarily lag.

**Screen permission:** on Android 14+, choose **Entire screen**, not one-app sharing, to watch different foreground apps. Android may obscure `FLAG_SECURE` offers, auto-stop a projection on lock, or limit overlays/notification visibility. ML Kit recognition runs approximately every two seconds *plus OCR time*, so an offer may expire before grading. Monitor battery/heat and test only when safely parked.

**Privacy:** whole-frame pixels are kept in memory only. Only parsed fields and **allow-list sanitized** text for the detected card window enter local SQLite. Unknown standalone text, names preceding star/Verified, and free-form rider/customer names following a known action label are discarded in tests. No rules-based sanitizer can *provably* recognize every person's name embedded inside a street or place string; review redacted exports before enabling optional sync. The app makes no networking calls in the capture service; optional app-level sync is OFF by default. Third-party SDK telemetry cannot be categorically excluded.

## Unchanged grading and data

Exact v1 rule: pickup miles/minutes included; if one-way **trip miles >= 75**, assume empty return of the same miles/minutes. For keyword-matched **dead-zone dropoff**, add **8 miles / 25 minutes**, stacking with long return. Effective distance/time are used for operating cost ($0.20/mile default) and NET grading. RED if net$/mile < 0.90 **OR** net$/hour < 20. GREEN if net$/mile >= 1.25 **AND** net$/hour >= 30 **AND** pickup complete; otherwise YELLOW. Defaults are editable in Settings and explicitly provisional; **no math or threshold code was changed from v1**. `PartialDeliveryGrader` is a separate conservative pathway for insufficient information; no fabricated NET values are displayed or uploaded for its records.

| Reference transcript | NET $/mile | NET $/hour | Stored verdict | Live badge |
|---|---:|---:|---|---|
| UberX Vienna → Arlington, $41.87 (includes +$18) | **3.31849** | **74.04375** | **GREEN** | **ACCEPT** |
| Lyft Comfort DC → NYC, $449 incl $50; 464.7 effective miles / 543 minutes | **0.76622** | **39.34** | **RED** | **SKIP** |

Each recognized offer is saved immediately in existing local SQLite table `offers` with platform/time/fare/legs/NET costs/verdict/address-like text/redacted OCR. Older v1/v2 records are preserved (same database/schema/application ID); additive optional JSON fields represent incomplete delivery offers. History detail, CSV/JSON export, manual outcome buttons, wait table, zones asset, voice switch, and optional sync contract remain unchanged. No new wait tracking was added. The driver may mark outcomes later from the History/Ver­dict screens; live capture never infers acceptance.

### Privacy and network

- **No images are persisted** or sent to any server; image memory is recycled. Stored `rawText` is produced by `CardPrivacy.sanitize`, stripping isolated and grouped name-like lines such as `Josh` and `Josh Verified ★4.8`; `pickupText`/`dropoffText` come only from address-looking lines. This is a rules-based sanitizer and **cannot guarantee** that a rider name mistakenly recognized as part of an address never survives. Review before enabling sync.
- **Sync defaults OFF**, and `SyncService` exits before URL/network code when disabled. The capture service has **no networking calls**. Enabling sync in Settings uploads redacted records to your configured HTTPS endpoint, as described in `Docs/RESULTS.md`. There is no automatic background sync.
- Google's ML Kit can transmit independent SDK diagnostics/usage telemetry according to its terms even when app sync is OFF; the OCR image itself stays on device. Absolute zero third-party SDK networking cannot be promised. See <https://developers.google.com/ml-kit/terms>.

## Pinned build stack

| Item | Exact value |
|---|---|
| Gradle wrapper distribution | **8.13** |
| AGP | **8.13.2** |
| Kotlin Android / Compose Compiler plugin | **2.3.10** |
| compileSdk / targetSdk / minSdk | **36 / 36 / 26** |
| Compose BOM | **2025.09.01** |
| activity-compose | **1.11.0** |
| bundled ML Kit Latin text-recognition | **16.0.1** |
| Kotlin coroutines android | **1.10.2** |
| applicationId | **com.rideoffercopilot.android** |
| versionName / versionCode | **2.1.0 / 3** |
| Kotlin compiler target | `kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }` |

No additional runtime libraries were added. Signing config was **not altered** from the v1 project (debug builds use standard Android debug signing; no paid service needed).

## Build Windows or CI (source only)

1. Extract the ZIP; open folder `RideOfferCopilot-Android` containing `settings.gradle.kts` in Android Studio. Install JDK **17**, Android SDK Platform **36** and Build Tools **36.0.0**; initial dependency download requires internet.
2. Windows terminal in project root:
   ```bat
   gradlew.bat :app:testDebugUnitTest :app:assembleDebug
   ```
   On macOS/Linux: `./gradlew :app:testDebugUnitTest :app:assembleDebug`. For source-only local checks run `python3 Scripts/check_source.py` or `./Scripts/run-core-smoke.sh` (needs `kotlinc`).
3. If the Gradle build succeeds, the unsigned-by-you **debug-signed** APK will be at `app/build/outputs/apk/debug/app-debug.apk`. Copy to Samsung and allow unknown-app installation or use `adb install -r app/build/outputs/apk/debug/app-debug.apk`. **No APK is included in this ZIP.**
4. CI: push project root to GitHub → **Actions → Android debug build → Run workflow**. The existing `.github/workflows/android-debug.yml` verifies source, runs JUnit and assembles APK, then uploads an artifact if successful. No paid Google Play or Apple account required.
5. For a smoke test, start live watch, allow **Entire screen**, switch to a static test screenshot on the phone (e.g. Gallery viewing the provided fixture), and verify one detection plus no duplicate after several frames; then test real Uber/Lyft offers only while safely parked. Test notification Stop, overlay denial, battery and long shift separately.

**Gradle wrapper limitation inherited from v1:** The authoring environment could not obtain the official `gradle-wrapper.jar`; it is **NOT bundled**. `gradlew` / `gradlew.bat` download the official Gradle 8.13 wrapper JAR on first run, verify SHA-256 `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`, then launch Gradle. The distribution itself has pinned SHA-256 in `gradle-wrapper.properties`. First CI/Android Studio build requires access to Gradle's download service; **build success is not guaranteed until tested**.

## Verification

- `Scripts/check_source.py` — pinned versions, v2 foreground-service/permission declarations, networking/QA invariants.
- `Scripts/run-core-smoke.sh` — offline Kotlin logic: original Uber/Lyft numbers, bonus, privacy, zone/long-trip, generalized detection gate, all six platform fixtures, partial-delivery estimates, three badge colors, consecutive-frame dedup + changed offer. Transcribed OCR fixtures only.
- `app/src/test/.../DomainTests.kt` — **9 existing JUnit tests, unchanged**.
- `app/src/test/.../LiveWatchTests.kt` — **5 carried-over JUnit tests** for offer gate, normal screens rejection, repeated-card dedup, changed offers and reset.
- `app/src/test/.../GenericOfferTests.kt` — **12 JUnit cases** for the six reference/constructed platforms, generic km, package-based label precedence, incomplete delivery null encoding, legacy JSON, all 3 badge states, and dedup. **These have not run under Gradle here.**
- `Docs/RESULTS.md` — exact test execution, what remains untested and acceptance checklist for Kiko.

**Official Android platform reference:** <https://developer.android.com/media/grow/media-projection> and <https://developer.android.com/develop/background-work/services/fgs/service-types>.
