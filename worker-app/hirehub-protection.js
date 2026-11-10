/* NEXVADORAQ HireHub — booking protection UI.
   Existing Login, jobs, GPS, FCM and chat flows remain in index.html. */
(function () {
  "use strict";
  const region = "asia-south1";
  let qrTokenCache = {};
  let scanStream = null;
  let scanFrame = null;

  function callable(name, data) {
    if (!window.firebase?.functions) throw new Error("Firebase Functions SDK not loaded. Refresh the app.");
    return firebase.app().functions(region).httpsCallable(name)(data);
  }
  function money(paise) {
    return "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  function assignedIds(b) {
    return Array.isArray(b.acceptedWorkerIds) ? b.acceptedWorkerIds : (b.workerId ? [b.workerId] : []);
  }
  function escText(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function statusPill(status) {
    return '<span class="pill">' + escText(status || "Pending") + "</span>";
  }
  async function getBookings() {
    let query;
    if (me.role === "customer") query = fbDb.collection("workerBookings").where("requesterId", "==", me.id);
    else if (me.role === "company") query = fbDb.collection("workerBookings").where("companyId", "==", me.id);
    else if (me.role === "worker") {
      const [a, b] = await Promise.all([
        fbDb.collection("workerBookings").where("acceptedWorkerIds", "array-contains", me.id).get(),
        fbDb.collection("workerBookings").where("workerId", "==", me.id).get()
      ]);
      const map = new Map();
      [...a.docs, ...b.docs].forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
      return [...map.values()].sort((x, y) => (y.createdAt?.toMillis?.() || 0) - (x.createdAt?.toMillis?.() || 0));
    } else return [];
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (y.createdAt?.toMillis?.() || 0) - (x.createdAt?.toMillis?.() || 0));
  }
  function customerCard(b) {
    const workers = assignedIds(b);
    const canPay = workers.length > 0 && b.amountPaise >= 100 && b.paymentStatus !== "Paid" && !["Cancelled", "Rejected"].includes(b.status);
    const qr = workers.length && ["Confirmed", "Partially Filled"].includes(b.status);
    const complete = b.status === "InProgress" && b.paymentStatus === "Paid";
    return '<article class="card" style="margin:12px 0"><div class="row"><b>' + escText(b.category) + "</b>" + statusPill(b.status) + '</div><p class="muted">' + escText(b.location) + " • " + escText(b.date) + " • " + escText(b.bookingType) + "</p><p>Workers: " + workers.length + " / " + escText(b.count || 1) + " • Total: <b>" + (b.amountPaise ? money(b.amountPaise) : "Amount not set") + "</b></p><p>Payment: " + escText(b.paymentStatus || "Not paid") + "</p>" +
      (canPay ? '<button class="primary" onclick="hireProtectionPay(\'' + escText(b.id) + '\')">Pay securely</button> ' : "") +
      (qr ? '<button class="primary" onclick="hireProtectionIssueQr(\'' + escText(b.id) + '\')">Show worker QR</button>' : "") +
      (complete ? '<button class="primary" onclick="hireProtectionComplete(\'' + escText(b.id) + '\')">Confirm work completed</button>' : "") +
      (b.status !== "Cancelled" && b.status !== "Completed" ? '<button class="ghost" onclick="hireProtectionRepeat(\'' + escText(b.id) + '\')">Book again</button> <button class="ghost" onclick="hireProtectionCancel(\'' + escText(b.id) + '\')">Cancel</button>' : "") +
      '<div id="hireQr_' + escText(b.id) + '" style="margin-top:12px"></div></article>';
  }
  function workerCard(b) {
    const accepted = assignedIds(b).includes(me.id);
    const eligible = accepted && ["Confirmed", "Partially Filled", "Pending"].includes(b.status);
    return '<article class="card" style="margin:12px 0"><div class="row"><b>' + escText(b.category) + "</b>" + statusPill(b.status) + '</div><p class="muted">' + escText(b.location) + " • " + escText(b.date) + " • " + escText(b.bookingType) + "</p><p>Pay offered: " + escText(b.pay || "As agreed in booking") + "</p>" +
      (eligible ? '<button class="primary" onclick="hireProtectionAgree(\'' + escText(b.id) + '\')">Accept digital agreement</button>' : "") +
      (accepted && b.status === "InProgress" ? '<p class="success">You are checked in. Customer will confirm completion.</p>' : "") +
      (accepted && b.amountPaise ? '<p><b>Estimated worker share:</b> ' + money(Math.floor(Number(b.amountPaise) * 0.85)) + ' • Settlement after completion</p>' : "") + (accepted && ["Confirmed", "Partially Filled"].includes(b.status) ? '<div class="field"><label>Customer QR token (or scan QR)</label><input id="hireToken_' + escText(b.id) + '" placeholder="Paste token from customer"></div><button class="primary" onclick="hireProtectionCheckin(\'' + escText(b.id) + '\')">Check in</button> <button class="ghost" onclick="hireProtectionScan(\'' + escText(b.id) + '\')">Scan QR with camera</button><div id="hireScan_' + escText(b.id) + '"></div>' : "") +
      "</article>";
  }
  async function render(el) {
    el.innerHTML = '<div class="card"><h3>Booking Protection & Rewards</h3><p class="muted">In-app payment, digital agreement, one-time QR attendance, repeat booking and transparent settlement.</p><p><b>Platform commission:</b> 15% of the booking total. <b>Worker share:</b> 85% before any applicable taxes or gateway charges. Worker payouts remain pending until the platform completes payout onboarding.</p></div><div id="hireProtectionList" class="muted">Loading your bookings…</div>';
    const box = document.getElementById("hireProtectionList");
    try {
      if (me.role === "worker") {
        const reward = await fbDb.collection("workerRewards").doc(me.id).get().catch(() => null);
        const r = reward?.exists ? reward.data() : {};
        box.innerHTML = '<div class="card"><h3>Worker Loyalty</h3><div class="metricrow"><div class="metric"><b>' + Number(r.points || 0) + '</b><span>Reward points</span></div><div class="metric"><b>' + Number(r.completedBookings || 0) + '</b><span>Completed jobs</span></div></div><p class="muted">ಪ್ರತಿ verified completed bookingಗೆ 10 reward points. Points ಹಣಕ್ಕೆ ಸಮಾನವಲ್ಲ; reward policy ಪ್ರಕಟಿಸಿದ ನಂತರ ಮಾತ್ರ redeem ಮಾಡಬಹುದು.</p></div>';
      }
      if (me.role === "admin") {
        if (me.adminLevel !== "super" && !(Array.isArray(me.permissions) && me.permissions.includes("payments"))) {
          box.innerHTML += '<p class="notice">Admin risk dashboard ನೋಡಲು Super Admin ಅಥವಾ Payments permission ಅಗತ್ಯ.</p>'; return;
        }
        const snap = await fbDb.collection("bookingRiskFlags").orderBy("createdAt", "desc").limit(100).get();
        box.innerHTML += (me.adminLevel === 'super' ? '<div class="card"><h3>Legacy Privacy Cleanup</h3><p class="muted">Remove old customer mobile numbers from shared booking documents so workers cannot read them.</p><button class="ghost" onclick="hireProtectionSanitizeContacts()">Sanitize old booking contacts</button></div>' : '') + '<h3>Booking Risk Review</h3>' + (snap.empty ? '<p class="muted">No risk flags.</p>' : snap.docs.map(d => {
          const x = d.data();
          return '<article class="card"><b>' + escText(x.type) + '</b><p>Booking: ' + escText(x.bookingId) + ' • Status: ' + escText(x.status) + '</p><p class="muted">Requester: ' + escText(x.requesterId) + ' • Pair cancellations: ' + escText(x.pairCancellationCount || "—") + '</p><button class="ghost" onclick="hireProtectionReviewFlag(\'' + escText(d.id) + '\')">Mark reviewed</button></article>';
        }).join(""));
        return;
      }
      const rows = await getBookings();
      if (!rows.length) { box.innerHTML += '<p class="empty">No bookings found yet.</p>'; return; }
      box.innerHTML += rows.map(me.role === "worker" ? workerCard : customerCard).join("");
    } catch (err) {
      box.innerHTML += '<p class="notice">Could not load protection data: ' + escText(err.code || err.message) + "</p>";
    }
  }

  window.renderHireHubProtection = render;

  window.hireProtectionIssueQr = async function (bookingId) {
    const target = document.getElementById("hireQr_" + bookingId);
    try {
      const result = await callable("issueHireHubBookingQr", { bookingId });
      const token = result.data.token;
      qrTokenCache[bookingId] = token;
      const payload = JSON.stringify({ bookingId, token });
      target.innerHTML = '<div class="notice">ಈ QR 15 ನಿಮಿಷಗಳವರೆಗೆ ಮಾತ್ರ ಮಾನ್ಯ. Worker ನಿಮ್ಮ ಎದುರಲ್ಲಿರುವಾಗ ಮಾತ್ರ ತೋರಿಸಿ.</div><div id="hireQrImage_' + escText(bookingId) + '" style="background:#fff;padding:12px;display:inline-block"></div><p class="muted">QR Token: ' + escText(token) + '</p><small>Expires: ' + escText(result.data.expiresAt) + "</small>";
      if (window.QRCode) new QRCode(document.getElementById("hireQrImage_" + bookingId), { text: payload, width: 190, height: 190 });
    } catch (err) { alert("QR ಸೃಷ್ಟಿಸಲಾಗಲಿಲ್ಲ: " + (err.message || err)); }
  };

  window.hireProtectionAgree = async function (bookingId) {
    try {
      if (!confirm("ಕೆಲಸದ ವಿವರ, ವೇತನ ಮತ್ತು 15% Platform Commission ಒಳಗೊಂಡ Digital Work Agreement ಅನ್ನು ಒಪ್ಪುತ್ತೀರಾ?")) return;
      await callable("acceptHireHubBookingAgreement", { bookingId });
      alert("Agreement accepted. Customer QR scan ಮಾಡಿ check-in ಮಾಡಿ.");
    } catch (err) { alert("Agreement ಸ್ವೀಕರಿಸಲಾಗಲಿಲ್ಲ: " + (err.message || err)); }
  };

  window.hireProtectionCheckin = async function (bookingId, scannedToken) {
    const input = document.getElementById("hireToken_" + bookingId);
    const token = scannedToken || input?.value?.trim();
    try {
      if (!token) throw new Error("Customer QR token ನಮೂದಿಸಿ ಅಥವಾ scan ಮಾಡಿ.");
      await callable("checkInHireHubWorker", { bookingId, token });
      alert("Check-in ಯಶಸ್ವಿಯಾಗಿದೆ. ಕೆಲಸ ಆರಂಭವಾಗಿದೆ.");
      go("protection");
    } catch (err) { alert("Check-in ವಿಫಲ: " + (err.message || err)); }
  };

  window.hireProtectionScan = async function (bookingId) {
    const box = document.getElementById("hireScan_" + bookingId);
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      box.innerHTML = '<p class="notice">ಈ ಸಾಧನದಲ್ಲಿ QR scan ಬೆಂಬಲವಿಲ್ಲ. Customer ತೋರಿಸಿದ token ಅನ್ನು ಮೇಲಿನ boxನಲ್ಲಿ paste ಮಾಡಿ.</p>'; return;
    }
    try {
      stopScanner();
      const video = document.createElement("video");
      video.autoplay = true; video.playsInline = true; video.style.cssText = "width:100%;max-width:320px;border-radius:12px";
      box.innerHTML = ""; box.appendChild(video);
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = scanStream;
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!scanStream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const data = JSON.parse(codes[0].rawValue);
            if (data.bookingId !== bookingId || !data.token) throw new Error("This QR belongs to another booking.");
            stopScanner();
            await window.hireProtectionCheckin(bookingId, data.token);
            return;
          }
        } catch (e) { if (e instanceof SyntaxError) { box.insertAdjacentHTML("beforeend", '<p class="notice">Invalid QR content. Try again.</p>'); stopScanner(); return; } }
        scanFrame = requestAnimationFrame(scan);
      };
      video.onloadedmetadata = scan;
      box.insertAdjacentHTML("beforeend", '<button class="ghost" onclick="hireProtectionStopScan()">Stop camera</button>');
    } catch (err) { stopScanner(); box.innerHTML = '<p class="notice">Camera permission / QR scan error: ' + escText(err.message) + "</p>"; }
  };
  function stopScanner() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = null;
    if (scanStream) scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  window.hireProtectionStopScan = stopScanner;

  window.hireProtectionPay = async function (bookingId) {
    try {
      if (!window.Razorpay) throw new Error("Payment checkout library did not load.");
      const result = await callable("createHireHubPaymentOrder", { bookingId });
      const options = {
        key: result.data.keyId, order_id: result.data.orderId, amount: result.data.amount,
        currency: result.data.currency, name: result.data.name, description: result.data.description,
        prefill: { name: me.name || "", email: me.email || "" },
        theme: { color: "#087f89" },
        handler: async response => {
          try {
            await callable("verifyHireHubPayment", { bookingId, ...response });
            alert("Payment verified. Booking payment is successful.");
            go("protection");
          } catch (err) { alert("Payment verification pending: " + (err.message || err)); }
        },
        modal: { ondismiss: () => console.info("Razorpay checkout dismissed") }
      };
      new Razorpay(options).open();
    } catch (err) { alert("Payment ಆರಂಭಿಸಲಾಗಲಿಲ್ಲ: " + (err.message || err)); }
  };

  window.hireProtectionComplete = async function (bookingId) {
    try {
      if (!confirm("ಕೆಲಸ ಸಂಪೂರ್ಣವಾಗಿ ಮುಗಿದಿದೆ ಎಂದು ಖಚಿತಪಡಿಸುತ್ತೀರಾ?")) return;
      const result = await callable("completeHireHubBooking", { bookingId });
      alert("ಕೆಲಸ ಪೂರ್ಣಗೊಂಡಿದೆ. Platform fee: " + money(result.data.platformFeePaise) + ". Worker payout settlement ಬಾಕಿಯಿದೆ.");
      go("protection");
    } catch (err) { alert("Completion ವಿಫಲ: " + (err.message || err)); }
  };

  window.hireProtectionCancel = async function (bookingId) {
    const reason = prompt("Cancellation ಕಾರಣ (ಐಚ್ಛಿಕ):") || "";
    if (!confirm("Booking cancel ಮಾಡಬೇಕೇ? Worker check-in ಆಗಿದ್ದರೆ cancellation fee policy ಅನ್ವಯಿಸಬಹುದು.")) return;
    try {
      const result = await callable("cancelHireHubBooking", { bookingId, reason });
      alert("Booking cancelled. Cancellation fee: " + money(result.data.cancellationFeePaise) + (result.data.requiresRefundReview ? ". Refund review ಅಗತ್ಯ." : "."));
      go("protection");
    } catch (err) { alert("Cancel ವಿಫಲ: " + (err.message || err)); }
  };

  window.hireProtectionRepeat = async function (bookingId) {
    try {
      const snap = await fbDb.collection("workerBookings").doc(bookingId).get();
      if (!snap.exists) throw new Error("Booking not found.");
      const b = snap.data();
      const customer = me.role === "customer";
      const data = {
        ...(customer ? { requesterId: me.id, requesterName: me.name, requesterRole: "customer" } : { companyId: me.id, companyName: me.name }),
        category: b.category || "General Helper", count: Number(b.count || 1),
        bookingType: b.bookingType || "Daily", durationMonths: Number(b.durationMonths || 1), location: b.location || me.city,
        date: "", shift: b.shift || "", pay: b.pay || "", amountPaise: Number(b.amountPaise || 0),
        platformCommissionBps: 1500, agreementVersion: "2026-11-v1",
        status: "Pending", visibility: "public", createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (customer) data.customerAgreementAccepted = true;
      if (customer && !["Hourly", "Daily"].includes(data.bookingType)) data.bookingType = "Daily";
      if (!customer && data.bookingType === "Hourly") data.bookingType = "Daily";
      await fbDb.collection("workerBookings").add(data);
      alert("ಹೊಸ Repeat Booking Request ಸೃಷ್ಟಿಸಲಾಗಿದೆ. ಹೊಸ ದಿನಾಂಕವನ್ನು Booking ವಿವರಗಳಲ್ಲಿ ಸೇರಿಸಿ.");
      go(customer ? "mybookings" : "booking");
    } catch (err) { alert("Repeat booking ವಿಫಲ: " + (err.message || err)); }
  };

  window.hireProtectionSanitizeContacts = async function () {
    try {
      if (me.role !== "admin" || me.adminLevel !== "super") throw new Error("Super Admin only.");
      if (!confirm("Old booking documentsನಲ್ಲಿರುವ customer mobile numbers delete ಮಾಡಬೇಕೇ?")) return;
      const result = await callable("sanitizeLegacyBookingContacts", {});
      alert(result.data.sanitized + " old booking contact records cleaned.");
      go("protection");
    } catch (err) { alert("Privacy cleanup ವಿಫಲ: " + (err.message || err)); }
  };

  window.hireProtectionReviewFlag = async function (flagId) {
    try {
      if (me.role !== "admin" || (me.adminLevel !== "super" && !(me.permissions || []).includes("payments"))) throw new Error("Admin permission required.");
      await fbDb.collection("bookingRiskFlags").doc(flagId).update({ status: "reviewed", reviewedBy: me.id, reviewedAt: firebase.firestore.FieldValue.serverTimestamp() });
      go("protection");
    } catch (err) { alert("Review update failed: " + (err.message || err)); }
  };
})();
