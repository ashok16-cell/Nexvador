const crypto = require("crypto");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const REGION = "asia-south1";
const COMMISSION_BPS = 1500;
const CANCELLATION_FEE_BPS = 1000;
const db = () => getFirestore();

function requireUser(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Please sign in.");
  return request.auth.uid;
}
async function getBooking(bookingId) {
  if (typeof bookingId !== "string" || !bookingId.trim()) throw new HttpsError("invalid-argument", "Booking ID is required.");
  const ref = db().collection("workerBookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
  return { ref, data: snap.data() };
}
function workerIds(b) {
  const ids = [...(Array.isArray(b.acceptedWorkerIds) ? b.acceptedWorkerIds : []), ...(b.workerId ? [b.workerId] : [])];
  // Include the legacy primary worker ID as well as multi-worker assignments.
  return [...new Set(ids.filter(x => typeof x === "string" && x.length > 0))];
}
function isRequester(uid, b) { return b.requesterId === uid || b.customerId === uid || b.companyId === uid; }
function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), "hex"), bb = Buffer.from(String(b), "hex");
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch (_) { return false; }
}
async function notify(recipientId, actorId, title, message, bookingId, eventType) {
  if (!recipientId || recipientId === actorId) return;
  await db().collection("notifications").add({
    recipientId, actorId, title, message: String(message).slice(0, 450),
    bookingId: bookingId || "", eventType: eventType || "booking_update",
    read: false, createdAt: FieldValue.serverTimestamp()
  });
}

exports.acceptHireHubBookingAgreement = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId;
  const { data: b } = await getBooking(bookingId);
  if (!workerIds(b).includes(uid)) throw new HttpsError("permission-denied", "Only an assigned worker can accept this agreement.");
  if (!["Confirmed", "Partially Filled", "Pending"].includes(b.status)) throw new HttpsError("failed-precondition", "This booking is not accepting work.");
  await db().collection("bookingAgreements").doc(bookingId + "_" + uid).set({
    bookingId, workerId: uid, accepted: true, agreementVersion: "2026-11-v1",
    commissionBps: Number(b.platformCommissionBps || COMMISSION_BPS),
    acceptedAt: FieldValue.serverTimestamp()
  });
  return { accepted: true };
});

exports.issueHireHubBookingQr = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId;
  const { data: b } = await getBooking(bookingId);
  if (!isRequester(uid, b)) throw new HttpsError("permission-denied", "Only the booking customer or company can issue this QR.");
  if (!["Confirmed", "Partially Filled", "InProgress"].includes(b.status)) throw new HttpsError("failed-precondition", "A worker must accept the booking first.");
  const ids = workerIds(b);
  if (!ids.length) throw new HttpsError("failed-precondition", "No worker has accepted this booking.");
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
  await db().collection("bookingProtection").doc(bookingId).set({
    bookingId, requesterId: uid, tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    workerIds: ids, expiresAt, usedWorkerIds: [], createdAt: FieldValue.serverTimestamp()
  });
  return { token, expiresAt: expiresAt.toDate().toISOString() };
});

exports.checkInHireHubWorker = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId, token = request.data?.token;
  if (typeof token !== "string" || token.length < 20) throw new HttpsError("invalid-argument", "Valid booking QR token required.");
  const { ref, data: b } = await getBooking(bookingId);
  if (!workerIds(b).includes(uid)) throw new HttpsError("permission-denied", "You are not assigned to this booking.");
  const agreement = await db().collection("bookingAgreements").doc(bookingId + "_" + uid).get();
  if (!agreement.exists || agreement.data().accepted !== true) throw new HttpsError("failed-precondition", "Accept the digital work agreement before check-in.");
  const protectionRef = db().collection("bookingProtection").doc(bookingId);
  const checkinRef = ref.collection("checkins").doc(uid);
  await db().runTransaction(async tx => {
    const ps = await tx.get(protectionRef);
    if (!ps.exists) throw new HttpsError("not-found", "Customer QR was not issued.");
    const p = ps.data();
    const currentBooking = await tx.get(ref);
    if (!currentBooking.exists || !["Confirmed", "Partially Filled", "InProgress"].includes(currentBooking.data().status)) throw new HttpsError("failed-precondition", "Booking is no longer active.");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    if ((p.usedWorkerIds || []).includes(uid) || !p.expiresAt || p.expiresAt.toMillis() < Date.now() || !safeEqualHex(hash, p.tokenHash) || !p.workerIds?.includes(uid)) {
      throw new HttpsError("permission-denied", "QR is invalid, expired, or already used. Ask the customer for a new QR.");
    }
    const old = await tx.get(checkinRef);
    if (old.exists) throw new HttpsError("already-exists", "You are already checked in.");
    tx.update(protectionRef, { usedWorkerIds: FieldValue.arrayUnion(uid), lastUsedAt: FieldValue.serverTimestamp() });
    tx.set(checkinRef, { workerId: uid, bookingId, checkedInAt: FieldValue.serverTimestamp(), status: "in_progress" });
    tx.update(ref, { status: "InProgress", workStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  await notify(b.requesterId || b.customerId || b.companyId, uid, "Worker checked in", "Assigned worker has checked in using the booking QR.", bookingId, "booking_checkin");
  return { checkedIn: true };
});

exports.createHireHubPaymentOrder = onCall({
  region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET]
}, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId;
  const { ref, data: b } = await getBooking(bookingId);
  if (!isRequester(uid, b)) throw new HttpsError("permission-denied", "Only the booking owner can pay.");
  if (!workerIds(b).length || ["Cancelled", "Rejected", "Completed"].includes(b.status)) throw new HttpsError("failed-precondition", "Only an active booking with an assigned worker can be paid.");
  const amount = Number(b.amountPaise);
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 50000000) {
    throw new HttpsError("failed-precondition", "This booking needs a valid total amount in INR before payment.");
  }
  if (b.paymentStatus === "Paid") throw new HttpsError("already-exists", "This booking is already paid.");
  const keyId = RAZORPAY_KEY_ID.value(), keySecret = RAZORPAY_KEY_SECRET.value();
  if (!keyId || !keySecret) throw new HttpsError("failed-precondition", "Razorpay keys are not configured by the platform administrator.");
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount, currency: "INR", receipt: String(bookingId).slice(0, 40),
      notes: { bookingId, customerUid: uid, platform: "NEXVADORAQ HireHub" }
    })
  });
  const order = await response.json();
  if (!response.ok || !order.id) throw new HttpsError("internal", "Payment gateway could not create the order. Please try again.");
  await db().collection("bookingPayments").doc(bookingId).set({
    bookingId, requesterId: uid, amountPaise: amount, currency: "INR",
    orderId: order.id, status: "order_created", commissionBps: Number(b.platformCommissionBps || COMMISSION_BPS),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await ref.set({ paymentStatus: "PaymentPending", paymentOrderId: order.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { keyId, orderId: order.id, amount: order.amount, currency: order.currency, name: "NEXVADORAQ HireHub", description: "Booking " + bookingId };
});

exports.verifyHireHubPayment = onCall({
  region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET]
}, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId, orderId = request.data?.razorpay_order_id;
  const paymentId = request.data?.razorpay_payment_id, signature = request.data?.razorpay_signature;
  const { ref, data: b } = await getBooking(bookingId);
  if (!isRequester(uid, b)) throw new HttpsError("permission-denied", "Only the booking owner can verify payment.");
  if (["Cancelled", "Rejected"].includes(b.status)) throw new HttpsError("failed-precondition", "Cancelled bookings cannot be paid.");
  const paymentOrder = await db().collection("bookingPayments").doc(bookingId).get();
  if (!paymentOrder.exists || paymentOrder.data().orderId !== orderId) throw new HttpsError("permission-denied", "Payment order does not belong to this booking.");
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET.value()).update(orderId + "|" + paymentId).digest("hex");
  if (!safeEqualHex(expected, signature)) throw new HttpsError("permission-denied", "Payment signature verification failed.");
  const auth = Buffer.from(RAZORPAY_KEY_ID.value() + ":" + RAZORPAY_KEY_SECRET.value()).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), { headers: { Authorization: "Basic " + auth } });
  const payment = await response.json();
  if (!response.ok || payment.order_id !== orderId || payment.status !== "captured" || Number(payment.amount) !== Number(b.amountPaise)) {
    throw new HttpsError("failed-precondition", "Gateway payment is not captured for this booking amount.");
  }
  const fee = Math.round(Number(b.amountPaise) * Number(b.platformCommissionBps || COMMISSION_BPS) / 10000);
  await db().runTransaction(async tx => {
    const pRef = db().collection("bookingPayments").doc(bookingId);
    tx.set(pRef, { bookingId, requesterId: uid, orderId, paymentId, amountPaise: payment.amount, currency: payment.currency || "INR", status: "captured", platformFeePaise: fee, workerPayoutPaise: Number(b.amountPaise) - fee, capturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref, { paymentStatus: "Paid", paymentId, paymentCapturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  for (const wid of workerIds(b)) await notify(wid, uid, "Booking payment received", "Customer payment was received. Complete the verified work to qualify for settlement.", bookingId, "booking_paid");
  return { paid: true, platformFeePaise: fee, workerPayoutPaise: Number(b.amountPaise) - fee };
});

exports.completeHireHubBooking = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId;
  const { ref, data: b } = await getBooking(bookingId);
  if (!isRequester(uid, b)) throw new HttpsError("permission-denied", "Only the customer or company can confirm completion.");
  if (b.status !== "InProgress") throw new HttpsError("failed-precondition", "Work must be checked in before completion.");
  if (b.paymentStatus !== "Paid") throw new HttpsError("failed-precondition", "Customer payment must be captured before completion.");
  const ids = workerIds(b);
  if (!ids.length) throw new HttpsError("failed-precondition", "No assigned worker found.");
  const checkins = await ref.collection("checkins").get();
  const checkedInIds = new Set(checkins.docs.map(d => d.id));
  if (!ids.every(id => checkedInIds.has(id))) throw new HttpsError("failed-precondition", "Every assigned worker must check in before completion.");
  const total = Number(b.amountPaise);
  const fee = Math.round(total * Number(b.platformCommissionBps || COMMISSION_BPS) / 10000);
  const perWorker = Math.floor((total - fee) / ids.length);
  await db().runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists || current.data().status !== "InProgress") throw new HttpsError("failed-precondition", "Booking state changed. Refresh and retry.");
    tx.update(ref, { status: "Completed", completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(db().collection("bookingPayments").doc(bookingId), {
      status: "completed_pending_settlement", amountPaise: total, platformFeePaise: fee,
      workerPayoutPaise: total - fee, payoutStatus: "pending_manual_or_razorpay_route",
      commissionBps: Number(b.platformCommissionBps || COMMISSION_BPS), completedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    for (const wid of ids) {
      tx.set(db().collection("workerRewards").doc(wid), {
        workerId: wid, points: FieldValue.increment(10), completedBookings: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });
  for (const wid of ids) await notify(wid, uid, "Work completed", "Customer confirmed completion. Your payout is pending settlement.", bookingId, "booking_completed");
  return { completed: true, platformFeePaise: fee, workerPayoutPaise: total - fee, workerCount: ids.length, estimatedPerWorkerPaise: perWorker };
});

exports.cancelHireHubBooking = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const bookingId = request.data?.bookingId, reason = request.data?.reason || "";
  const { ref, data: b } = await getBooking(bookingId);
  if (!isRequester(uid, b)) throw new HttpsError("permission-denied", "Only the booking owner can cancel.");
  if (["Completed", "Cancelled", "Rejected"].includes(b.status)) throw new HttpsError("failed-precondition", "This booking cannot be cancelled in its current state.");
  const checkins = await ref.collection("checkins").get();
  const arrived = !checkins.empty;
  const fee = arrived ? Math.round(Number(b.amountPaise || 0) * CANCELLATION_FEE_BPS / 10000) : 0;
  await ref.update({ status: "Cancelled", cancellationReason: String(reason).slice(0, 300), cancelledAt: FieldValue.serverTimestamp(), cancellationFeePaise: fee, updatedAt: FieldValue.serverTimestamp() });
  if (arrived && workerIds(b).length) {
    await db().collection("bookingRiskFlags").add({
      bookingId, requesterId: uid, workerIds: workerIds(b), type: "cancelled_after_worker_checkin",
      cancellationFeePaise: fee, status: "review_required", createdAt: FieldValue.serverTimestamp()
    });
  }
  for (const wid of workerIds(b)) await notify(wid, uid, "Booking cancelled", "The customer cancelled this booking. Please check the cancellation record.", bookingId, "booking_cancelled");
  return { cancelled: true, cancellationFeePaise: fee, requiresRefundReview: b.paymentStatus === "Paid" };
});

exports.flagRepeatedBookingCancellations = onDocumentUpdated({
  document: "workerBookings/{bookingId}", region: REGION
}, async event => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  if (!before || !after || before.status === "Cancelled" || after.status !== "Cancelled") return;
  const ids = workerIds(after);
  if (!ids.length || !after.requesterId) return;
  const recent = await db().collection("workerBookings")
    .where("requesterId", "==", after.requesterId).limit(50).get();
  const pairCount = recent.docs.filter(d => d.data().status === "Cancelled" && workerIds(d.data()).some(id => ids.includes(id))).length;
  if (pairCount < 2) return;
  await db().collection("bookingRiskFlags").add({
    bookingId: event.params.bookingId, requesterId: after.requesterId, workerIds: ids,
    type: "repeated_customer_worker_cancellations", pairCancellationCount: pairCount,
    status: "review_required", createdAt: FieldValue.serverTimestamp()
  });
});

exports.razorpayHireHubWebhook = onRequest({
  region: REGION, secrets: [RAZORPAY_WEBHOOK_SECRET]
}, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const signature = req.get("x-razorpay-signature") || "";
  const raw = req.rawBody || Buffer.from("");
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET.value()).update(raw).digest("hex");
  if (!safeEqualHex(expected, signature)) return res.status(400).send("Invalid webhook signature");
  const event = req.body?.event;
  const payment = req.body?.payload?.payment?.entity;
  if (event === "payment.captured" && payment?.order_id && payment?.id) {
    const q = await db().collection("bookingPayments").where("orderId", "==", payment.order_id).limit(1).get();
    if (!q.empty) {
      const p = q.docs[0], bookingId = p.id, bSnap = await db().collection("workerBookings").doc(bookingId).get();
      if (bSnap.exists && Number(payment.amount) === Number(bSnap.data().amountPaise)) {
        const b = bSnap.data(), fee = Math.round(Number(payment.amount) * Number(b.platformCommissionBps || COMMISSION_BPS) / 10000);
        await db().runTransaction(async tx => {
          tx.set(p.ref, { paymentId: payment.id, amountPaise: payment.amount, status: "captured", platformFeePaise: fee, workerPayoutPaise: Number(payment.amount) - fee, capturedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.set(bSnap.ref, { paymentStatus: "Paid", paymentId: payment.id, paymentCapturedAt: FieldValue.serverTimestamp() }, { merge: true });
        });
      }
    }
  }
  return res.status(200).json({ received: true });
});

exports.sanitizeLegacyBookingContacts = onCall({ region: REGION }, async request => {
  const uid = requireUser(request);
  const admin = await db().collection("users").doc(uid).get();
  if (!admin.exists || admin.data().role !== "admin" || admin.data().adminLevel !== "super") {
    throw new HttpsError("permission-denied", "Super Admin only.");
  }
  const snap = await db().collection("workerBookings").get();
  let changed = 0, batch = db().batch(), writes = 0;
  for (const doc of snap.docs) {
    if (Object.prototype.hasOwnProperty.call(doc.data(), "requesterMobile")) {
      batch.update(doc.ref, { requesterMobile: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      changed++; writes++;
      if (writes === 450) { await batch.commit(); batch = db().batch(); writes = 0; }
    }
  }
  if (writes) await batch.commit();
  return { sanitized: changed };
});

// v1.1: security-reviewed QR, payment and attendance transitions.
