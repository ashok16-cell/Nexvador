# NEXVADORAQ Cloud Run Functions

Google Cloud Run Functions (2nd gen) API for HireHub. Firebase Auth and Firestore remain the identity/database providers.

## Deployment
Run GitHub Actions **NEXVADORAQ Google Cloud Run Functions Deploy**. Requires a billing-enabled Google Cloud project, Cloud Functions/Cloud Run/Cloud Build/Artifact Registry API access, and sufficient service account permissions.

## API
POST to the deployed hirehubApi URL with JSON body and `Authorization: Bearer <Firebase ID token>`.

- `{"action":"acceptWorkerBooking","bookingId":"..."}`
- `{"action":"getOrCreateHireHubDisplayId","newAccount":true}`

The endpoint permits unauthenticated *transport* so that browser/mobile Firebase ID tokens can be verified by the application; requests without a valid Firebase ID token are rejected with HTTP 401. Configure ALLOWED_ORIGINS as a comma-separated list of trusted web origins before enabling browser callers. Mobile callers do not need CORS.

## Cutover safety
The existing Firebase callable endpoints and Firestore event triggers are deliberately retained. Do not switch clients or remove legacy functions until new URLs are confirmed and tested. Firestore notification triggers and client API migration remain pending.
