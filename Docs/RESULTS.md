# RideOffer Copilot Android v2.0.0 — BUILD / QA RESULTS

## Delivered implementation (source)

- App ID unchanged `com.rideoffercopilot.android`, versionCode **2**, versionName **2.0.0**. Existing SQLite schema, offline OCR parser, iOS-equivalent grading engine, zones, optional sync, history, export, settings, manual screenshot import and original 9 JUnit cases are **retained**.
- New: `LiveWatchService` foreground service with typed `mediaProjection`, explicit per-session capture intent, one MediaProjection/virtual display per consent, callback for platform capture revocation, notification Stop action, 2s frame cadence, resolution cap, battery-aware screen-off OCR pause, cropped bottom-card OCR via ML Kit, filtered detection, immediate SQLite auto-log, in-app feed status, optional TTS.
- New: `LiveOverlay` small top-screen, tap-to-dismiss overlay badge and short auto-fade; if permission denied/revoked, high-priority verdict notification fallback, subject to notification permission. Green verdict displays ACCEPT; red **and yellow** display SKIP live (stored yellow unchanged).
- New: `LiveOfferGate` detects likely Uber/Lyft offer-card text, `LiveOfferDedup` suppresses consecutive and recent-identical records with time-limited fingerprint and allows a changed offer immediately. Manual image handling remains in `MainActivity`/`CopilotUI`.
- Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `SYSTEM_ALERT_WINDOW` (optional overlay), `POST_NOTIFICATIONS` (runtime on 13+), and original `INTERNET` (optional sync). No Accessibility service, notification listener, location, storage, camera, microphone or boot receiver.
- Service never calls network; existing sync is OFF by default and only runs on explicit main-app open (when enabled) / Sync now. The third-party ML Kit SDK may independently emit telemetry; zero SDK network traffic cannot be guaranteed.

## What was actually tested

**PASS — run in authoring environment:**

1. `python3 Scripts/check_source.py`: verified pinned Gradle/AGP/Kotlin/Compose/SDK/ML Kit versions, v2 package/version, typed foreground service and permissions, live flow markers, no Accessibility service, and existing privacy / networking guards.
2. `./Scripts/run-core-smoke.sh`: `kotlinc` compiled `Models.kt`, `DecisionEngine.kt`, `OfferParser.kt`, `LiveOfferGate.kt` and `LiveOfferDedup.kt` and ran pure JVM assertions: real card **transcripts**, bonuses, raw text name stripping, long-trip, zones, missing pickup, parser rearrangement, valid-card detection, normal-map rejection, repeat dedup and changed-fare detection.
3. **PASS:** executed all **5 new `LiveWatchTests` methods** on the local JVM with a minimal temporary JUnit-compatible assertion/annotation harness (the actual Gradle/JUnit runtime was not used); each returned PASS.
4. Inspected Android manifest, Gradle pins, source structure and archive completeness. Confirmed **original 9 JUnit methods** remain unchanged byte-for-byte and **5 new JUnit methods** are included.

**NOT TESTED here:** Gradle/AGP compile, JUnit running under Gradle, produced/debug APK, an Android emulator or Galaxy S25 Ultra, ML Kit OCR on actual screenshot pixels (only transcribed text), Android 14–16 MediaProjection consent/service activation, background task kill / battery, screen-on/off, screen rotation/resize, `FLAG_SECURE` capture rejection, overlay settings and actual floating view, notification heads-up and Stop, TTS while Uber/Lyft is foreground, live detection latency or missed offers, signed APK install, optional server sync. **No real-device runtime success is claimed.**

**Inherited wrapper exception:** official `gradle-wrapper.jar` not included. Bootstrap scripts fetch/check official Gradle 8.13 JAR at first CI/Android Studio command; this may fail if Gradle download endpoint is unreachable. Project tests and build cannot be guaranteed to pass until run by CI.

## Locked calibration regressions (pure Kotlin, transcribed fixtures)

| Sample | Fare / legs | Effective totals | NET $/mi | NET $/hr | Stored verdict | Live overlay |
|---|---|---|---:|---:|---|---|
| UberX Vienna → Arlington | $41.87 (includes +$18), pickup 2.6mi/9min, trip 9.3mi/23min | 11.9mi / 32min | **3.31849** | **74.04375** | GREEN | ACCEPT |
| Lyft Comfort DC → NYC | $449 incl $50, pickup 0.7mi/5min, trip 232mi/269min | 464.7mi / 543min (empty return) | **0.76622** | **39.34** | RED | SKIP |

Existing thresholds and source engine were **not modified**. All numbers remain provisional. Borderline YELLOW continues to be recorded as YELLOW, but the glanceable live badge uses **SKIP** as a conservative prompt; manual Verdict screen still displays BORDERLINE.

## Offer detection and dedup tests

- UberX + price + combined legs + Match → accepted by detection gate; Lyft + Incl. bonus + 2 legs + Accept → accepted.
- An ordinary map with Uber name, distance-only and time-only lines → rejected. A receipt with no Uber/Lyft offer cue → rejected. No fare → rejected.
- Same parsed offer across consecutive frames → one record, even with a brief OCR drop (3 missed checks) inside a 90-second cooldown.
- Changed fare on otherwise similar offer → new record immediately.
- Session reset clears dedup state; identical offer after time cooldown can be re-logged. Two separate identical offers during the cooldown may be conflated; real offers can be missed or duplicated due to OCR text errors.

## Known platform/UX limitations

- **Per-session permission:** Android 14+ disallows caching/reusing projection result tokens for multiple virtual displays. User must approve every session. Android may stop a projection unilaterally; callbacks release resources. Users should choose **Entire screen** to switch between Uber/Lyft.
- **Overlay optional:** drawing over other apps requires user-managed special access; notification fallback requires notification permission/channel configuration. Android can suppress heads-up notifications; banner visibility is not guaranteed.
- **Not instantaneous:** cadence ~2s plus OCR/ML Kit processing and rendering. A rapidly expiring card can disappear before detection. Only the lower ~66% of the screen is scanned; if Uber/Lyft shift card positions, detection may fail.
- **Privacy:** raw OCR kept only after `CardPrivacy.sanitize`; isolated names and grouped `Josh Verified` patterns removed; screenshots never saved. This regex allow-list cannot guarantee removing every possible name embedded within an address. Any optional sync transfers the sanitized saved text, only after user enables it.
- **Battery/foreground:** notification Stop releases capture and UI overlay; screen off skips OCR. OS power management and OEM restrictions may end the service. No reboot automatic restart.
- **Read only:** no acceptance automation, no accessibility scraping, no account, no ads. Driver is responsible for safe operation; never manipulate device while moving.

## Kiko review checklist (must perform on CI and Samsung)

1. Build with `./gradlew :app:testDebugUnitTest :app:assembleDebug --stacktrace`. Verify **9 existing + 5 new** JUnit tests, APK generated and installs on S25 Ultra; capture build log. Verify gradle-wrapper official SHA.
2. Start live watch: grant Android system consent **Entire screen** and enable overlay special access; verify persistent service notification and Stop action. Reopen app and verify Live status; stop and restart to confirm fresh consent.
3. Display each sample screenshot fullscreen on the phone in Gallery (while consenting to entire screen capture). Compare ML Kit live OCR candidate values and exact calibration above. Be aware Gallery menus can cover the card; test on genuine offer screens separately, while safely parked.
4. Keep same card onscreen for 20+ sec; verify **exactly one** History row. Change fare/route card; verify new row. Turn overlay off while watching, verify notification fallback and live feed. Deny notifications; check the limitations are explained and Home still displays latest offer.
5. Rotate phone, turn screen off/on, dismiss overlay, tap Stop notification, revoke projection from system. Verify no service leaks/crashes, no image files saved, and no name text in persisted/exported records.
6. Change thresholds/costs and confirm engine calibration restores when defaults restored. Test long-trip/dead-zone stack, CSV/JSON export, History, manual screenshot share/import, TTS on/off, delete confirmation. Ensure existing v1 DB records survive upgrade.
7. Confirm OFF-by-default optional sync makes **no app-owned network POST** in service or UI; enable only against test endpoint, verify payload and 200/401/retry behavior. Observe SDK telemetry as a separate issue.
8. Profile battery, OEM foreground restrictions and offer detection latency on Samsung over a realistic parked driving-shift simulation; **not proven** in this delivery.
