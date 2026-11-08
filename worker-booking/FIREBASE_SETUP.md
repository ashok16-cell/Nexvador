# NEXVADORAQ Worker Booking — Firebase setup

This is a separate backend setup for the Pan-India Worker Booking app. Do not replace the Community app's Firebase configuration or Firestore rules.

## Create the separate Firebase project
1. Open https://console.firebase.google.com/
2. Select **Add project** and name it `nexvadoraq-worker` (or another available name).
3. Add a **Web app** named `NEXVADORAQ Worker Web`.
4. Copy the Firebase web configuration. Do not post private service-account keys or passwords.
5. In Authentication, enable Phone sign-in only after configuring the required SMS/verification settings and testing them.
6. Create a Cloud Firestore database.
7. Open Firestore Rules and publish the contents of `firestore.rules` after reviewing them.

## Current implementation status
- The current website is still a front-end demo using browser-local storage.
- These rules are a security starting point; the website does not yet call Firebase.
- Do not collect identity documents, bank details, or payments in this demo.
- Booking and payment access is intentionally denied until those workflows are implemented and reviewed.

## What is needed to connect it
Send the **Firebase web app configuration** (the object containing apiKey, authDomain, projectId, appId, and storageBucket if present). It is client-side configuration, not a service-account private key. Then the app code can be updated to use Firebase Authentication and Firestore.

## Pan-India data fields
Store both `city` and `state` on job records. Use a consistent state/UT list and normalized city names for reliable search.
