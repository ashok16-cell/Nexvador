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

## Create the first administrator safely
1. Create the administrator's email/password account in Firebase Authentication.
2. Copy that user's Firebase Authentication UID.
3. In Cloud Firestore, create `users/{UID}` with fields:
   - `uid`: same UID string
   - `email`: administrator email
   - `name`: administrator display name
   - `role`: `admin`
   - `active`: `true`
4. Sign in through the app's Admin tab. Admin self-registration is disabled.
5. Keep administrator credentials private. Never put service-account keys in the app or repository.

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
