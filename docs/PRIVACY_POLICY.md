# PickleJudge Privacy Policy

**Effective date:** _[fill in on publication]_
**Contact:** _[your support email]_

## Summary

PickleJudge processes camera video **entirely on your device** to determine
where a pickleball bounced. Video frames are never uploaded, never stored, and
never transmitted off your phone. We do not have servers that receive your
video. We do not have accounts.

## What the app accesses

**Camera.** Required. The app analyses live frames to locate the ball. Frames
are processed in memory and discarded immediately. No video or still image is
written to storage or transmitted, unless you explicitly use a "save clip"
feature (if present in your build, it saves only to your device's photo
library at your request).

**Local network.** Required for two-device mode. Your two phones connect
directly to each other over your local Wi-Fi. The only data exchanged between
them is: clock-synchronisation timestamps, and, for each bounce, a small
numeric record consisting of a timestamp, an (x, y) court coordinate in
metres, an uncertainty covariance, and a confidence score. Roughly 100 bytes
per bounce. No video, no audio, no identifiers.

**Microphone.** Not accessed.
**Location.** Not accessed.
**Contacts, photos, files.** Not accessed, except a photo-library write if you
explicitly export a clip.

## What we collect

Nothing that identifies you. We operate no backend that receives your data.

_[If you enable crash reporting, replace this paragraph with:]_ We use
_[Sentry / Firebase Crashlytics]_ to receive anonymous crash reports
containing a device model, OS version, and a stack trace. These reports
contain no video, no court data, and no personal identifiers. See _[vendor's
policy URL]_.

_[If you add analytics, you MUST amend this document and both stores'
privacy disclosures before shipping that build.]_

## Children

The app is not directed at children under 13 and collects no data from anyone.

## Legal basis and your rights

Because we hold no personal data, there is nothing to access, correct,
export, or delete on our side. Deleting the app removes all local data,
including your saved court calibration.

## Changes

Material changes will be reflected here with a new effective date and, where
required, an in-app notice.

## Jurisdiction

_[Your entity name and address. Required by both stores. If publishing as an
individual from India, this is your name and city; the store will display the
developer name publicly either way.]_
