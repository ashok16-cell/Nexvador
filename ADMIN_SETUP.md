# NEXVADORAQ deployment and admin setup

## Current app architecture
- One Android app / one web app: `worker-app/`
- One sign-in screen with Worker, Company and Admin roles.
- Firebase Authentication (Email/Password) and Cloud Firestore.
- Android build workflow: `.github/workflows/separate-apps-android.yml`

## Firebase project
The client currently points to Firebase project `nexvadoraq-hirehub`.
Before production, verify that this is the intended project and that billing, Authentication and Firestore are configured.

## Deploy Firestore rules
Install Firebase CLI, sign in with an authorized Firebase account, then run:
```bash
firebase use nexvadoraq-hirehub
firebase deploy --only firestore:rules
```
The repository contains `firebase.json` and `firestore.rules`. A GitHub commit does not automatically deploy rules to Firebase.


## One-click GitHub deployment

A manual workflow is available at **Actions → NEXVADORAQ Firebase Deploy → Run workflow**. Before using it:

1. In Firebase Console / Google Cloud IAM for `nexvadoraq-hirehub`, create a dedicated service account for CI deployment. Grant only the permissions needed to deploy Firebase Hosting and Firestore Security Rules (Firebase Hosting Admin and Firebase Rules Admin, subject to your project's IAM setup).
2. Create a JSON key for that service account and add the complete JSON contents as a GitHub Actions repository secret named `FIREBASE_SERVICE_ACCOUNT_NEXVADORAQ_HIREHUB`.
3. Keep this key private. Never commit it to the repository, paste it into the app, or share it in chat. Rotate/revoke it if exposed.
4. Open the repository's Actions tab, select **NEXVADORAQ Firebase Deploy**, choose `hosting-and-rules`, and run it only after reviewing the rules and testing accounts.

The workflow validates the app's inline JavaScript and deployment files, then deploys the selected resources. A successful workflow run is the evidence that deployment completed. Until that run succeeds, hosting/rules deployment remains pending.

## Create the first administrator safely

The app intentionally blocks Admin self-registration. Because Firestore rules also block client-side creation of an `admin` profile, provision the first administrator with the trusted Firebase Admin SDK (not the browser console):

1. Create the administrator account in Firebase Authentication using Email/Password.
2. Copy that account's Firebase Authentication UID.
3. On a trusted computer, install the Admin SDK dependency in a temporary working folder: `npm install firebase-admin`.
4. Download a service-account JSON with narrowly scoped project access. Keep it outside this repository; never commit it or paste it into chat.
5. Run the repository script from the project root:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS="/secure/path/service-account.json" ADMIN_UID="FIREBASE_AUTH_UID" node scripts/bootstrap-admin.mjs
   ```
6. Sign in through the app's Admin tab using that Auth account. Admin self-registration remains disabled.

The script verifies the Auth account and refuses to silently promote an existing non-admin profile. Protect and revoke service-account keys when no longer needed.

## Required Firebase checks
- Enable Email/Password under Authentication > Sign-in method.
- Create the Cloud Firestore database in production mode.
- Deploy `firestore.rules` before allowing public registrations.
- Test Worker and Company accounts separately with two test email addresses.
- Test job create/list/apply, employer application review, worker profile, booking submission and admin moderation.
- Verify rules with the Firebase Emulator / Rules Playground before production.

## Release checklist
- Android workflow currently creates a debug APK artifact. It is for testing, not Play Store publishing.
- A Play Store release requires a signed Android App Bundle (AAB), a protected upload keystore, privacy policy, Data Safety declarations, app listing and Play Console review.
- Configure production email verification, abuse prevention, rate limiting, data retention, consent and support contact before launch.
- Payments, OTP/SMS, identity verification, push notifications and background location tracking are not production-enabled by this repository alone.
- Do not collect Aadhaar, bank details or precise location unless there is a documented lawful purpose, explicit consent and secure backend controls.

## Important limitation
A successful GitHub Actions build proves compilation only. It does not prove Firebase rules have been deployed or that all live user flows have passed end-to-end testing.
