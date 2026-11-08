# NEXVADORAQ Firebase activation checklist

The website now contains Firebase email/password sign-up and sign-in, shared Firestore profiles and posts, member-to-member live chat, in-app message alerts, and a restricted admin dashboard.

## Required one-time Firebase Console setup

1. Open https://console.firebase.google.com/ and select project **nexvadoraq**.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. In **Authentication → Settings → Authorized domains**, add **ashok16-cell.github.io**.
4. In **Firestore Database**, create the database (production mode / location appropriate to your users).
5. Open **Firestore Database → Rules**, paste the contents of `firestore.rules` from this repository, and click **Publish**.
6. Confirm the web app configuration in **Project settings → General → Your apps**. If Firebase has not registered a Web app yet, register one and use its Web App configuration in `firebase-config.js`. The API key and project ID currently use the Firebase values supplied for NEXVADORAQ; the Android app ID must not be reused as a Web app ID.

## Granting administrator access

1. Sign in to NEXVADORAQ once with the account that should be the administrator.
2. In Firebase Console → Authentication → Users, copy that account's **UID**.
3. In Firestore, create a document in collection **admins**, using that exact UID as the document ID. A small field such as `role: "admin"` may be added.
4. Do not allow clients to write to the `admins` collection. The supplied rules intentionally deny all client writes.

## Current feature boundaries

- Shared profiles and posts, chat, and in-app notifications use Firestore after the Console setup above is completed.
- The admin dashboard checks the protected `admins/{uid}` record before showing reports.
- Device push notifications (FCM) are not enabled yet. They require a Web Push certificate (VAPID key), service-worker messaging setup, and notification permission.
- Phone OTP sign-in is not enabled; the current login is email/password.
- This GitHub Pages app is loaded inside the existing Android WebView APK, so the website changes appear in the installed app when it has internet access. The APK itself does not need rebuilding for these website-only changes.

Never put a Firebase service-account private key in this public repository.
