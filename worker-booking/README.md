# NEXVADORAQ Worker Booking

A separate Worker + HR/Company booking web app for all of India (Pan India).

## Preview
https://ashok16-cell.github.io/Nexvador/worker-booking/

## Included in this starter
- Worker and HR/Company role selection
- Daily, hourly and monthly job categories across Indian states and cities
- Job posting and worker applications (browser-local demo storage)
- Responsive mobile-first interface
- Basic PWA manifest and offline shell

## Important status
This is a front-end prototype, not a production booking service. User profiles, jobs and applications currently stay in the browser where they were created. They are not shared with other phones or users. There is no OTP verification, real-time booking, payments, background checks, admin moderation or production security yet.

## Before public launch
1. Create a dedicated Firebase project for this Worker app (recommended, to keep the Community app isolated).
2. Enable Firebase Authentication and choose the sign-in method.
3. Create Firestore and deploy reviewed security rules for workers, companies, jobs, applications and bookings.
4. Add the new Firebase web configuration to this app only.
5. Test on multiple devices, add privacy policy, terms, support contact and data deletion process.
6. Build/sign the Android app and complete Google Play Console testing and policy declarations.

Do not use this demo to collect sensitive identity or payment information.


Android APK build setup updated on 2026-11-08.

APK build retry after Android SDK package fix.

Build config updated to Java 21 for Capacitor Android.
