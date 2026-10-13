# Firebase Spark setup

Dedicated project: **page-grove-hq**. Keep the project on Spark with no billing account. This application uses Firebase Authentication and Firestore for optional accounts and reading-record sync. It does not require Firebase Hosting: the website remains on GitHub Pages.

Device imports stay in this browser's IndexedDB. Optional Google Drive folder sync keeps newly connected books in Drive, loads their contents temporarily for reading, and allows per-device offline copies. Firebase stores reading metadata and Drive references, not original files, full text, illustrations, or Drive access tokens. Existing device copies remain offline when connected to Drive. Local passage repairs to Drive books pin an offline copy and are not uploaded to Drive or Firebase.

## Console setup

1. Register the Web app **Page Grove HQ Web** inside `page-grove-hq`. Do not use another PageGroveHQ project's Firebase app.
2. Authentication → Sign-in method: enable **Google**, public-facing name **Page Grove HQ**, and the owner's support email. Keep the email provider enabled during migration. Old email callbacks remain supported, but the frontend now offers Google sign-in. From an existing email session, **Connect Google sign-in** links the provider to the existing Firebase UID. Choose the same Google email; do not delete/recreate Firebase users.
3. Authentication → Settings → Authorized domains: add `pagegrovehq.github.io`. Local testing can use `localhost`; add `127.0.0.1` only if testing email callbacks on that host.
4. Create a **Standard** Firestore database `(default)` in `us-east1`, starting in production mode. Publish the exact rules in `firebase/firestore.rules`. They restrict each user to their own document collection and enforce revision increments.
5. Put the **public web configuration** in `public/cloud-config.json`, set `bookStorage` to `device`, and enable the deployment only after the rules and Auth provider are ready. Never put service-account credentials or an AI API key in this file.
6. Build and deploy the website. A reader signs in through Account & sync, then explicitly chooses **Sync progress & notes**. Signing in alone does not upload an existing library.

CLI alternative for rules: `firebase deploy --only firestore:rules --project page-grove-hq`. Use an explicitly named project every time; do not change global project aliases.

## Free-plan limits

Spark is quota-limited. Hitting a quota can stop the affected service; it does not automatically upgrade to Blaze. Google sign-in avoids Spark's small email-link allowance. See the official [Auth limits](https://firebase.google.com/docs/auth/limits) and [pricing](https://firebase.google.com/pricing).

## Google Drive configuration

Enable **Google Drive API** in Google Cloud project **page-grove-hq**. Firebase supplies the Google web OAuth client; do not add any client secret or service-account key to the frontend. In Google Auth Platform, configure branding as **Page Grove HQ**, the support/developer contact, and Data Access scope `https://www.googleapis.com/auth/drive.readonly`. For personal/testing use, add the owner's Google email under Audience test users. Keep the existing authorized domain `pagegrovehq.github.io` and Firebase handler `https://page-grove-hq.firebaseapp.com/__/auth/handler`. Do not enable billing, Firebase Storage, or another project's services.

Normal Google sign-in does not request Drive access. **Connect Google Drive** separately reauthenticates the signed-in Google user and requests read-only access. Google grants this across Drive; the app only scans the selected folder and optional descendants. It performs no Drive uploads, changes or deletes. Tokens stay in memory and expire; reconnect after reload or expiry. Disconnecting clears the device's token and pauses folder checks; revoke the grant separately in Google account third-party connections.

First scan downloads supported files sequentially to extract titles, covers, word counts and fingerprints, reconnects matching existing records, then releases full text for cloud-only entries. Later scans skip unchanged books, flag changed editions for explicit replacement, and mark missing files without deleting notes. Checks run while the app is visible, authorized, online and outside the reader, at most every five minutes; manual checks are immediate. Removed shelf entries are suppressed on later scans, without deleting their Drive files. Errors for individual unsupported/DRM/malformed/oversized books remain visible.

Drive file IDs and folder settings sync with progress through Firebase. Offline copies are per-device. Replacing a changed edition preserves numeric positions and annotations but requires review against the new text and replaces local repairs. A full library backup includes downloaded text and restores Drive books as offline copies.

`drive.readonly` is a restricted scope. Personal-use apps may qualify for verification exceptions and show an unverified warning. Broader public use needs Google's restricted-scope review; transmitting restricted Drive metadata to Firebase may also require a security assessment. See [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) and [verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Google provider, token lifecycle, folder pagination, ownership, temporary caching, identity preservation and changed-file handling have synthetic regression tests. These do not substitute for the owner's live Google consent or an authenticated two-device check.

Cloud Storage requires Blaze billing even though eligible usage has free allowances. It is not provisioned or used in this Spark setup. Paid AI and background server OCR also remain disabled. Local OCR and local dictionary/vocabulary tools remain available.

## Reconnecting older libraries and duplicate recovery

Refresh both devices, then use **Sync now** on the device with the original file first. Older imports receive their missing file fingerprint locally. Sync compares existing cloud records before publishing local entries, so matching imports and bundled samples reconnect instead of becoming new books. Sample IDs are deterministic across devices. Full text and originals remain local; only file/text fingerprints enter the reading record.

If a legacy cloud record still lacks a fingerprint, import its original file and select **Connect to an older synced record** in the preview. This is an explicit choice of the same book and edition; ordinary books are never joined by title alone. If a full local copy already exists beside a fileless synced record, open the full copy's **Details**, choose the intended record, and click **Connect file & keep synced position**.

Automatic reconciliation keeps the established record, joins annotations and sessions, and records another meaningful reading position as a recovered bookmark. Consolidated local copies are retained in the recovery archive, and their original bytes are retained. **Settings → Export recovered copies** exports those snapshots. Cloud aliases become revisioned redirects only after the combined record has uploaded; they retain their prior metadata as tombstones. Deliberately choosing **Add another copy** creates a separate copy that reconciliation respects. Files currently open in a reader wait until the reader closes before being joined.

The two-device reconciliation regression uses an in-memory Firestore transport with real IndexedDB operations; it tests migration, import-before-download, duplicate joining, note preservation, and file retention. It does not impersonate real users or replace a live authenticated check.

## Reliability and privacy

Firestore uses a memory-only SDK cache. Page Grove stores its library and a durable per-user outbox locally; original files are never deleted by Spark sync. Transactional revisions detect concurrent edits. Compatible annotations and sessions merge, while competing reading positions and notes require a choice. Annotation tombstones prevent deleted notes from returning.

The owner-only read rules were checked in Firebase's Rules Playground for owner access, signed-out denial, and another-account denial. These are simulations, not a substitute for an authenticated two-device integration test. Live email delivery and cross-device sync must be verified with real sign-ins; do not claim those tests based only on a build or simulator.

Use local library backups for full book recovery. The cloud reading index cannot reconstruct a lost original file. Accounts and data-removal controls need additional work before a broad public account launch. Browser storage and GitHub Pages origins should be treated as shared with any other app under the same origin; app-specific databases and scoped service workers prevent accidental naming collisions but are not separate origins.
