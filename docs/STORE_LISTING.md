# Store Listing, Privacy Disclosures, and Review Notes

Everything here is ready to paste. Character limits are respected.

---

## Apple App Store

**Name (30):** `PickleJudge`
**Subtitle (30):** `Dual-camera line judge`

**Promotional text (170):**
Two phones, one court, honest calls. PickleJudge measures where the ball
actually landed — and tells you when it is too close to be sure.

**Description:**
```
PickleJudge turns two phones into a synchronised line-calling system for
pickleball.

Set one phone on each sideline, tap six court landmarks on each, and play.
When the ball bounces, both phones measure the contact point independently,
align their clocks to within a few milliseconds, and combine their
measurements into a single answer.

HONEST BY DESIGN
Most line-call apps give you a verdict no matter what. PickleJudge tells you
its confidence. When a ball lands too close to the line to be resolved, it
says so — the same thing a good line judge says — instead of guessing. You
replay the point.

WHAT IT DOES
- Rally line calls: in, out, with the distance from the line
- Serve calls, including non-volley-zone faults
- Sub-frame bounce timing, so the contact point is where the ball actually
  touched, not where it was one video frame later
- Works with one phone; more accurate with two

WHAT IT DOES NOT DO
- It does not upload your video. Nothing leaves your phone except a hundred
  bytes per bounce, sent directly to your other phone over your own Wi-Fi.
- It does not replace an official in sanctioned play.

SETUP
Two phones, two tripods about two metres high placed just outside each
sideline near mid-court. The app shows you the placement and warns you if the
angle is too shallow for reliable calls.

PickleJudge is not affiliated with, endorsed by, or sponsored by USA
Pickleball or any governing body.
```

**Keywords (100, comma-separated, no spaces):**
`pickleball,line,judge,call,out,in,court,referee,umpire,camera,bounce,serve,kitchen,tennis`

**Support URL / Marketing URL / Privacy Policy URL:** _[required, HTTPS]_

**Age rating:** 4+. Answer all age-rating questions — Apple's updated question
set has been mandatory since 31 Jan 2026.

### App Privacy answers (App Store Connect)

- **Data Used to Track You:** None.
- **Data Linked to You:** None.
- **Data Not Linked to You:**
  - If crash reporting is enabled: *Diagnostics → Crash Data* and
    *Performance Data*. Purpose: App Functionality. Not used for tracking.
  - Otherwise: **Data Not Collected.**

Do not claim "Data Not Collected" if you ship Crashlytics or Sentry. That
mismatch is an automatic rejection and, post-approval, a removal risk.

### Review Notes (paste into App Review Information)

```
PickleJudge requires two devices on the same Wi-Fi network to demonstrate its
primary feature. A single device is fully functional in single-camera mode,
which is what the reviewer will see without a second device.

To evaluate on one device:
1. Grant camera permission.
2. Tap "Single camera".
3. Point at the demo court image included at Settings > Demo Mode, or at any
   flat surface, and tap the six calibration targets in order.
4. Tap "Start". Roll or drop any small ball across the surface; the app will
   report a contact point and a verdict.

Demo Mode (Settings > Demo Mode) replays a bundled recording end-to-end and
requires no court, no ball, and no second device.

Camera use: video frames are analysed in memory to locate the ball and are
immediately discarded. No frames are stored or transmitted. Local network
access is used only to exchange numeric bounce estimates directly between the
user's two devices; there is no server.

The app is not affiliated with any pickleball governing body and does not
claim to replace officials in sanctioned play; this is stated in the
description and in an in-app first-run notice.
```

**Guideline exposure to pre-empt:**
- *2.1 / completeness*: a reviewer with one device must reach a working
  verdict. Demo Mode exists for exactly this. Build it before submitting.
- *4.2 minimum functionality*: the accuracy claim is the differentiator;
  ensure the confidence display is visible in screenshots.
- *5.1.1 purpose strings*: `NSCameraUsageDescription` and
  `NSLocalNetworkUsageDescription` must state the specific purpose, not
  "to use the app". Suggested strings are in `android/BUILD_CONFIG.md`'s iOS
  section.

---

## Google Play

**App name (30):** `PickleJudge — Line Judge`
**Short description (80):**
`Two phones. One court. Line calls with honest confidence, computed on device.`

**Full description:** reuse the App Store description above (4,000-char limit,
well within it).

### Data Safety form answers (Play Console)

- **Does your app collect or share any of the required user data types?**
  - If no crash reporting: **No.**
  - If crash reporting: **Yes** → *App info and performance → Crash logs* and
    *Diagnostics*. Collected, not shared. Not required (user can opt out) —
    only claim optional if you actually build the toggle. Processed
    ephemerally: No. Purpose: App functionality, Analytics.
- **Is all user data encrypted in transit?** Yes (WebRTC DataChannel is DTLS-
  encrypted; declare it).
- **Do you provide a way for users to request data deletion?** Not applicable
  — no data is collected. Link the privacy policy.

Declaring "no data collected" while shipping any analytics SDK is the fastest
route to a Play policy strike. Audit your `package.json` before you answer.

### Play policy items specific to this app

- **Camera permission:** declared and used in the foreground only. Do not
  request background camera.
- **Photos/Media:** do not request unless you ship clip export.
- **Health/Fitness claims:** make none. "Line judge" is not a health claim.
- **Sensitive permissions declaration:** none needed for camera + local
  network.

---

## Screenshots — the shot list

Take these on a real court. Store reviewers and users both discount rendered
mockups, and Apple rejects screenshots that misrepresent the app.

1. Live view mid-rally with a call overlay reading `OUT — 34 mm past the line`.
2. The same view reading `TOO CLOSE — 71% in`. This is the product's thesis.
   Lead with it in the Play listing.
3. Calibration screen mid-tap, magnifier loupe visible, reprojection error
   shown as `0.4 px`.
4. Rig placement diagram.
5. Two-phone pairing QR screen.
6. Session summary: calls made, calls declined, mean confidence.
