# NEXVADORAQ HireHub – Firebase setup & launch checklist

## Firebase project used by this repository
The web app reads its configuration from `worker-app/firebase-config.js`.
Current configured project ID: `nexvadoraq`.

Before deploying, open Firebase Console and confirm that this is the intended project. Do not replace it with another project unless you deliberately want to move the app and its user data.

## One-time Firebase Console setup
1. Open https://console.firebase.google.com/ and select `nexvadoraq`.
2. **Authentication → Sign-in method**: enable **Email/Password**.
3. **Authentication → Settings → Authorized domains**: add `ashok16-cell.github.io`. Add any custom domain used by the app as well.
4. **Firestore Database**: create the database in the intended region. Do not use test mode.
5. **Storage**: enable Firebase Storage if profile photo upload is required.
6. In Project settings → Your apps, confirm the Web App configuration matches `worker-app/firebase-config.js`.

## Publish the security rules
Run these commands from the repository root on a computer with Node.js and Firebase CLI installed:

```bash
npm install -g firebase-tools
firebase login
firebase use nexvadoraq
firebase deploy --only firestore:rules,storage
```

The repository root `firebase.json` points to `firestore.rules` and `storage.rules`. This command publishes the rules; committing a rules file to GitHub alone does **not** publish it to Firebase.

## App features included in the current HireHub web build
- Separate Worker and Company account roles
- Email/password registration, login and password-reset email
- Role-aware dashboard and profile
- Company job posting and worker applications
- Application status updates
- Worker-initiated, opt-in live GPS sharing; Android APK uses a persistent foreground location notification for background updates; browser preview remains foreground-only
- FCM push delivery through a Firestore-triggered Firebase Cloud Function (requires Android Firebase app configuration and Blaze plan)
- Profile photo upload to Firebase Storage (photo reads restricted to the account owner by the Storage rules)
- Installable web-app manifest, home-screen icon, and a clear offline connection screen
- Published Privacy Policy and Terms of Use pages
- Cloud notifications and account-scoped cloud data syncing

## Required tests before public launch
Use two different email accounts and two phones/browsers:
1. Register one Worker and one Company.
2. Sign out and log in again with each account; confirm the wrong role cannot enter the other dashboard.
3. Post a job as Company; confirm it appears for Worker.
4. Apply as Worker; confirm Company sees the application.
5. Shortlist/accept/reject the application; confirm the Worker sees the updated status.
6. Test Forgot Password and confirm the email arrives.
7. Test photo upload, then test location sharing only after the Worker explicitly opts in; press Stop and confirm the location disappears.
8. Test that one account cannot edit another account's job/profile/application.
9. Test on Android Chrome and the installed Android build, if applicable.
10. Verify the Privacy Policy and Terms of Use links from the app footer.
11. Confirm the app can be installed from Android Chrome; test that offline mode shows the connection notice and that the app refreshes to the newest online release.

## Important production gaps / cautions
- Email/password is not phone OTP or identity verification.
- Live GPS sharing works only while the app is active in this web build; it is not background or emergency tracking.
- Do not collect Aadhaar, bank details, passwords, or payment-card data in this prototype.
- Add a privacy policy, terms, support contact, account/data deletion workflow, and moderation/abuse reporting before a public Play Store launch.
- The current rules allow company accounts to read worker booking requests and live locations as required by the current company workflow. Review the business consent and privacy design before launch.
- No APK or Play Store release is produced by deploying Firestore rules. Android packaging/signing and Play Console review are separate steps.

## Android background GPS and Push Notification setup

1. In Firebase Console → Project settings → Your apps, register an Android app with package ID `com.nexvadoraq.app`.
2. Download that Android app's `google-services.json`. Base64-encode the file and add it to GitHub repository Settings → Secrets and variables → Actions as `GOOGLE_SERVICES_JSON_BASE64`. Do not commit the raw file or service-account credentials.
3. Run the NEXVADORAQ HireHub Android workflow again and install its newly generated APK.
4. In the Worker account, open Notifications and press **Enable Push Notifications**. Confirm Android notification permission and check that the device token is saved to `users/{uid}.fcmToken`.
5. For background GPS, open Location Sharing and press Start. Grant precise location and the persistent notification permission. Keep sharing enabled only during an active job; use Stop Location to end it. Android may show a persistent notification while tracking.
6. The `sendHireHubPush` Cloud Function sends an FCM push whenever a Firestore `notifications/{id}` document is created. Deploy it with the GitHub Firebase workflow using `functions-only`, or `firebase deploy --project nexvadoraq --only functions:sendHireHubPush`. Cloud Functions deployment requires the Firebase Blaze billing plan.

Background tracking is subject to Android battery restrictions, user permissions, network coverage and device power management. Test on a physical Android phone with the screen locked for at least 15 minutes. It is not emergency tracking.


## Latest deployment status (10 Nov 2026)

- Android debug APK workflow completed successfully. Latest run: https://github.com/ashok16-cell/Nexvador/actions/runs/42832389072
- The APK artifact is named `NEXVADORAQ-HireHub-APK` in that run.
- Firebase Cloud Function deployment was attempted, but Google Cloud rejected automatic API enablement: `Permissions denied enabling artifactregistry.googleapis.com`.

### One-time Google Cloud owner action required

A Google Cloud Project Owner (or an administrator with Service Usage Admin permissions) must:
1. Open https://console.cloud.google.com/apis/library/artifactregistry.googleapis.com?project=nexvadoraq and enable **Artifact Registry API**.
2. Also enable **Cloud Functions API** and **Cloud Build API** for project `nexvadoraq`.
3. Confirm the Firebase project is on the **Blaze** plan and billing is active before deploying Cloud Functions.
4. Ensure the GitHub Actions service account has permissions to deploy Cloud Functions 2nd gen and use Cloud Build / Artifact Registry (for example, appropriate Cloud Functions Developer, Service Account User, Cloud Build, and Artifact Registry permissions).
5. In Firebase Project settings, register Android app package `com.nexvadoraq.app`, download `google-services.json`, Base64-encode it, and save the value as GitHub Actions secret `GOOGLE_SERVICES_JSON_BASE64`.
6. Re-run the Android workflow to build an APK with native Firebase Messaging configuration, then run the Firebase workflow with target `functions-only`.

Do not paste service-account JSON or the raw Google Services file into chat or commit either file to the repository. These owner-level Google Cloud actions cannot be completed by a repository code change alone.
