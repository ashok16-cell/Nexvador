/**
 * NEXVADORAQ Firebase Auth numeric-UID migration planner.
 *
 * SAFETY: This tool only exports an inventory and a proposed old->numeric UID map.
 * It NEVER creates users, changes Firestore documents, or deletes Auth accounts.
 * Run locally with Application Default Credentials for project nexvadoraq.
 *
 *   node scripts/plan-auth-uid-migration.js
 *
 * Output contains personal data. Keep it private; do not commit or share it.
 */
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "nexvadoraq";
const START_ID = Number(process.env.NUMERIC_UID_START || "100001");
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "./private-auth-migration");

if (!Number.isSafeInteger(START_ID) || START_ID < 1) {
  throw new Error("NUMERIC_UID_START must be a positive safe integer.");
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(OUTPUT_DIR, 0o700); } catch (_) {}

  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  // Stable ordering makes the plan reproducible across runs.
  users.sort((a, b) => a.uid.localeCompare(b.uid));
  const map = users.map((u, index) => ({
    oldUid: u.uid,
    newUid: String(START_ID + index),
    email: u.email || null,
    phoneNumber: u.phoneNumber || null,
    displayName: u.displayName || null,
    emailVerified: Boolean(u.emailVerified),
    disabled: Boolean(u.disabled),
    providerIds: (u.providerData || []).map(p => p.providerId)
  }));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inventoryPath = path.join(OUTPUT_DIR, `auth-inventory-${timestamp}.json`);
  const mappingPath = path.join(OUTPUT_DIR, `uid-mapping-PLAN-${timestamp}.json`);
  fs.writeFileSync(inventoryPath, JSON.stringify({
    projectId: PROJECT_ID,
    generatedAt: new Date().toISOString(),
    totalUsers: users.length,
    users: map.map(({ oldUid, email, phoneNumber, displayName, emailVerified, disabled, providerIds }) =>
      ({ oldUid, email, phoneNumber, displayName, emailVerified, disabled, providerIds }))
  }, null, 2), { mode: 0o600 });
  fs.writeFileSync(mappingPath, JSON.stringify({
    projectId: PROJECT_ID,
    generatedAt: new Date().toISOString(),
    status: "PLAN_ONLY_NOT_APPLIED",
    totalUsers: map.length,
    mapping: map
  }, null, 2), { mode: 0o600 });

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Firebase Auth accounts found: ${users.length}`);
  console.log(`Inventory: ${inventoryPath}`);
  console.log(`UID plan: ${mappingPath}`);
  console.log("NO ACCOUNTS WERE CREATED OR DELETED. NO FIRESTORE DATA WAS CHANGED.");
  console.log("Before applying a migration, every UID reference in Firestore, Storage rules,");
  console.log("FCM tokens, role claims, and app clients must be migrated and verified.");
  console.log("Firebase Auth passwords cannot be exported; users will need password reset.");
}

main().catch(error => {
  console.error("Migration planning failed:", error.message);
  process.exitCode = 1;
});
