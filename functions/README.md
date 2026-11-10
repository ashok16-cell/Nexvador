# HireHub FCM delivery

Firestore notification documents created at `notifications/{id}` trigger the `sendHireHubPush` Cloud Function. It looks up the recipient's `users/{uid}.fcmToken` / `fcmTokens` and sends an FCM notification. Invalid tokens are pruned.

Deploy with `firebase deploy --project nexvadoraq --only functions:sendHireHubPush`.

Requirements:
- Firebase project must be on the Blaze plan for Cloud Functions deployment.
- Register an Android app in Firebase Project Settings using application ID `com.nexvadoraq.app`.
- Add the downloaded Android `google-services.json` as a base64-encoded GitHub Actions secret named `GOOGLE_SERVICES_JSON_BASE64`. The Android build workflow consumes this secret when present.
- Install the new APK and enable Notifications in the HireHub app. Push delivery cannot be verified until a real Android device token is registered.

Deployment note: the Firebase GitHub workflow validates and deploys this function when a commit changes `functions/**`.
