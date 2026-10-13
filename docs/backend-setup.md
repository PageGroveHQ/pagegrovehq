# Firebase Spark setup

Dedicated project: **page-grove-hq**. Keep the project on Spark with no billing account. This application uses Firebase Authentication and Firestore for optional accounts and reading-record sync. It does not require Firebase Hosting: the website remains on GitHub Pages.

Book files, full extracted text, covers, original PDFs, and illustrations stay in this browser's IndexedDB. Synced records contain titles, source-file fingerprints, reading positions, bookmarks, intentionally saved excerpts and notes, profiles, vocabulary, shelves, and reading sessions. Import the same file on another device to reconnect its reading record. Text repairs and original files do not sync. Pasted articles can be moved through a library backup.

## Console setup

1. Register the Web app **Page Grove HQ Web** inside `page-grove-hq`. Do not use another PageGroveHQ project's Firebase app.
2. Authentication → Sign-in method: enable Email/Password and Email link (passwordless sign-in). The frontend uses email links, not password forms.
3. Authentication → Settings → Authorized domains: add `pagegrovehq.github.io`. Local testing can use `localhost`; add `127.0.0.1` only if testing email callbacks on that host.
4. Create a **Standard** Firestore database `(default)` in `us-east1`, starting in production mode. Publish the exact rules in `firebase/firestore.rules`. They restrict each user to their own document collection and enforce revision increments.
5. Put the **public web configuration** in `public/cloud-config.json`, set `bookStorage` to `device`, and enable the deployment only after the rules and Auth provider are ready. Never put service-account credentials or an AI API key in this file.
6. Build and deploy the website. A reader signs in through Account & sync, then explicitly chooses **Sync progress & notes**. Signing in alone does not upload an existing library.

CLI alternative for rules: `firebase deploy --only firestore:rules --project page-grove-hq`. Use an explicitly named project every time; do not change global project aliases.

## Free-plan limits

Spark is quota-limited. Hitting a quota can stop the affected service; it does not automatically upgrade to Blaze. Email-link sign-in has a particularly small Spark email allowance, so a larger public launch should consider adding Google sign-in. See the official [Auth limits](https://firebase.google.com/docs/auth/limits) and [pricing](https://firebase.google.com/pricing).

Cloud Storage requires Blaze billing even though eligible usage has free allowances. It is not provisioned or used in this Spark setup. Paid AI and background server OCR also remain disabled. Local OCR and local dictionary/vocabulary tools remain available.

## Reliability and privacy

Firestore uses a memory-only SDK cache. Page Grove stores its library and a durable per-user outbox locally; original files are never deleted by Spark sync. Transactional revisions detect concurrent edits. Compatible annotations and sessions merge, while competing reading positions and notes require a choice. Annotation tombstones prevent deleted notes from returning.

The owner-only read rules were checked in Firebase's Rules Playground for owner access, signed-out denial, and another-account denial. These are simulations, not a substitute for an authenticated two-device integration test. Live email delivery and cross-device sync must be verified with real sign-ins; do not claim those tests based only on a build or simulator.

Use local library backups for full book recovery. The cloud reading index cannot reconstruct a lost original file. Accounts and data-removal controls need additional work before a broad public account launch. Browser storage and GitHub Pages origins should be treated as shared with any other app under the same origin; app-specific databases and scoped service workers prevent accidental naming collisions but are not separate origins.
