# StudyFlow Android 2.0

The current APK is `artifacts/StudyFlow-2.0.0.apk`. It bundles the React interface inside a Capacitor Android WebView. Normal navigation stays in StudyFlow; only API requests and private files use https://studyflowrmd.duckdns.org. There is no remote `server.url`, Trusted Web Activity, or browser-based launch in this version. External links may open their appropriate external app.

The original `StudyFlow-1.0.0.apk` was a Trusted Web Activity and is superseded. Version 2 uses the same package ID and signing key with a higher versionCode, so Android can install it as an update. You may need to sign in again because the old version used browser storage.

## Included

- Bundled screens, StudyFlow launcher icon and splash screen.
- Native HTTP transport to the existing AWS API (including authenticated uploads).
- Android back-button handling.
- In-app PDF pages and offline saved PDFs.
- Android share/save sheet for PDFs, attachments, student-code CSV and attendance exports.

Requires Android 7.0 or newer and an up-to-date Android System WebView. Live student/teacher data still needs internet. Background push notifications require a separate native notification setup; the in-app activity feed works while online. This is a hybrid Android app, not a Kotlin rewrite or a Play Store publication.

## Build and sign

Use Java 21, Node, Android SDK platform 36 and build-tools 36.0.0. Install JavaScript dependencies with `npm ci --prefix react-frontend`. Then run `./mobile/build-native.ps1` from PowerShell. The script builds the frontend, syncs Capacitor, builds Android and signs/verifies the APK. It uses the existing private release key.

Back up `mobile/signing/studyflow-release.jks` and `mobile/signing/credentials.json` privately together. Never publish them. They are excluded from Git and deployment archives. Future updates must keep this key and increase versionCode in `react-frontend/android/app/build.gradle`.

No AWS deployment or assetlinks verification is required for this APK. The existing backend stays unchanged. Web frontend improvements in the working tree can be deployed separately when desired.

## Install and check

Transfer `artifacts/StudyFlow-2.0.0.apk` to your Android phone and open it. Permit installation from that specific source if prompted. Install it over version 1. Test teacher/student sign-in, attendance, file selection/upload, PDF viewing, CSV sharing, back navigation and offline saved files. Do not distribute the `studyflow-aligned.apk` intermediate file; it is unsigned.
