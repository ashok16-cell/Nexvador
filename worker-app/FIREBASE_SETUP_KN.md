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
- Worker-initiated, opt-in live GPS sharing; company live-worker map
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
