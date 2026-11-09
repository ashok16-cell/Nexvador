/**
 * Securely provision the first NEXVADORAQ administrator.
 * Run locally with a Firebase service-account JSON kept OUTSIDE this repository:
 *   GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json ADMIN_UID=<firebase-auth-uid> node scripts/bootstrap-admin.mjs
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const uid = process.env.ADMIN_UID;
if (!uid) throw new Error("Set ADMIN_UID to the existing Firebase Authentication user UID.");

initializeApp({
  credential: applicationDefault(),
  projectId: "nexvadoraq-hirehub",
});

const auth = getAuth();
const db = getFirestore();
const account = await auth.getUser(uid);
if (!account.email) throw new Error("The selected Firebase Auth account must have an email address.");

const ref = db.collection("users").doc(uid);
const existing = await ref.get();
if (existing.exists && existing.data()?.role !== "admin") {
  throw new Error("Refusing to promote an existing non-admin profile automatically. Review it manually first.");
}

await ref.set({
  uid,
  email: account.email,
  name: account.displayName || "NEXVADORAQ Administrator",
  role: "admin",
  active: true,
  updatedAt: FieldValue.serverTimestamp(),
  ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
}, { merge: true });

console.log(`Administrator profile provisioned for ${account.email} (${uid}).`);
