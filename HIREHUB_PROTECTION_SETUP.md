# NEXVADORAQ HireHub — Booking Protection Setup

This change adds a protected booking workflow to the existing worker-app without replacing Firebase Auth, jobs, GPS, FCM notifications or in-app conversations.

## Included
- Customer/company payment checkout through Razorpay Orders.
- Server-side payment signature and captured-payment verification.
- 15% platform commission ledger; 85% worker share before applicable taxes and gateway charges.
- Digital worker agreement acceptance.
- Short-lived booking QR (15 minutes), one check-in per assigned worker.
- Customer confirmation after verified worker check-in.
- Repeat booking action and 10 loyalty points per completed booking.
- Cancellation assessment after check-in and repeated cancellation risk flags.
- Customer mobile number is no longer copied into new shared booking documents.
- In-app chat blocks common Indian mobile-number patterns in the UI and Firestore rules.
- Super Admin can run a one-time cleanup for legacy booking documents containing requesterMobile.

## Important payment limitation
The backend records the worker share as pending_manual_or_razorpay_route. It does not transfer money to workers automatically. Automated payouts require Razorpay Route approval, linked worker accounts/KYC, payout consent and a separate tested transfer workflow. Cancellation fees are assessed for review; this release does not automatically charge a cancellation fee or issue refunds.

## Required one-time setup
1. Confirm the Firebase project is nexvadoraq.
2. Set the three Razorpay secrets using Firebase CLI (never commit them to GitHub or the web app):
   - firebase functions:secrets:set RAZORPAY_KEY_ID --project nexvadoraq
   - firebase functions:secrets:set RAZORPAY_KEY_SECRET --project nexvadoraq
   - firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET --project nexvadoraq
3. In Razorpay Dashboard, add a webhook pointing to:
   https://asia-south1-nexvadoraq.cloudfunctions.net/razorpayHireHubWebhook
   Subscribe to payment.captured; use the same webhook secret saved above.
4. Deploy Functions after secrets are set:
   firebase deploy --project nexvadoraq --only functions
   Or run the GitHub Actions NEXVADORAQ Firebase Deploy workflow with functions-only.
5. Firestore Rules are included in firestore.rules. The repository push workflow deploys Firestore Rules on a rules-only change. Verify the workflow result before testing.
6. In the app, create a new test booking with a numeric total amount. Existing bookings without amountPaise cannot use the new checkout until their amount is explicitly updated.

## Test sequence
1. Customer creates a booking with total amount.
2. Worker accepts the booking using the existing Accept flow.
3. Worker opens Booking Safety and accepts the digital agreement.
4. Customer opens Booking Safety, issues a QR and shows it to the assigned worker.
5. Worker scans the QR (Android Chrome BarcodeDetector support required) or pastes the token manually.
6. Customer pays through Razorpay Checkout; backend verifies the captured payment.
7. Every assigned worker checks in; customer confirms completion.
8. Check bookingPayments for commission and payout status; check workerRewards for loyalty points.
9. Admin reviews bookingRiskFlags.

## Security notes
- QR token is stored as a SHA-256 hash in Firestore and expires after 15 minutes.
- Payment secrets are only read by Cloud Functions.
- bookingProtection, bookingAgreements, bookingPayments, rewards and risk flags have restricted Firestore rules.
- New bookings do not store the customer's mobile number in the shared workerBookings document.
- Run Booking Safety → Sanitize old booking contacts as Super Admin to remove requesterMobile from older booking documents.
- The chat phone-number filter is a deterrent, not a guarantee that users cannot exchange contact details through other channels.

## Before public launch
Complete real-device testing for Customer, Worker and Company accounts. Confirm Razorpay test-mode checkout, webhook delivery, Firestore permissions, QR camera permission, multi-worker attendance, refund policy, privacy notice, terms and payout operations. Do not advertise automatic worker payout until Razorpay Route is approved and tested.