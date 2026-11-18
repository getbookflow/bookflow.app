document.title = "LIVE OK";
// ===== BookFlow : live.js =====
// Alertes en direct (réservations), sonnerie et appels vocaux reçus dans le tableau de bord.
// Utilise app.js (supabaseClient, $, ensureCompany, customers, loadCustomers, loadBookings...).

// Serveurs qui aident deux appareils à se trouver pour l'appel vocal.
// Pour que les appels marchent sur TOUS les réseaux mobiles, ajoutez un serveur TURN ici :
//   { urls: "turn:adresse-du-serveur:443", username: "...", credential: "..." }
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

/* ---------- 1. SON ---------- */
let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// Le navigateur n'autorise le son qu'après un premier toucher de l'utilisateur
["click", "touchstart", "keydown"].forEach((name) => {
  document.addEventListener(name, () => { getAudio(); }, { once: true });
});

function tone(freq, offset, duration, volume) {
  const ctx = getAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + offset;

  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function playNotifSound() {
  tone(880, 0, 0.18, 0.25);
  tone(1174, 0.2, 0.25, 0.25);
}

let ringTimer = null;

function startRing() {
  stopRing();
  const burst = () => {
    tone(740, 0, 0.35, 0.3);
    tone(988, 0.4, 0.35, 0.3);
  };
  burst();
  ringTimer = setInterval(burst, 1800);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 1000, 400, 200, 400]);
}

function stopRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

/* ---------- 2. MESSAGES À L'ÉCRAN (toasts) ---------- */
function showToast(options) {
  const box = $("toasts");
  if (!box) return null;

  const el = document.createElement("div");
  el.className = "toast " + (options.kind || "info");
  el.setAttribute("role", "status");

  const body = document.createElement("div");
  body.className = "toast-body";

  const title = document.createElement("strong");
  title.textContent = options.title || "";
  body.appendChild(title);

  if (options.text) {
    const text = document.createElement("span");
    text.textContent = options.text;
    body.appendChild(text);
  }

  const remove = () => el.remove();

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fermer");
  close.textContent = "×";
  close.addEventListener("click", remove);

  el.append(body, close);

  if (options.actions && options.actions.length) {
    const row = document.createElement("div");
    row.className = "toast-actions";

    options.actions.forEach((action) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        action.onClick();
        remove();
      });
      row.appendChild(b);
    });

    el.appendChild(row);
  }

  box.prepend(el);

  if (!options.sticky) setTimeout(remove, 12000);

  return { el: el, remove: remove };
}

/* ---------- 3. ALERTES (son, titre de l'onglet, notification du navigateur) ---------- */
let unread = 0;
const baseTitle = document.title;

function bumpTitle() {
  if (document.hidden) {
    unread++;
    document.title = "(" + unread + ") " + baseTitle;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    unread = 0;
    document.title = baseTitle;
  }
});

function browserNotify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      new Notification(title, { body: body, tag: "bookflow" });
    }
  } catch (error) {}
}

function alertUser(title, text, kind, extra) {
  playNotifSound();
  bumpTitle();
  browserNotify(title, text);
  return showToast(Object.assign({ title: title, text: text, kind: kind || "success" }, extra || {}));
}

function refreshNotifButton() {
  const btn = $("enableNotifs");
  if (!btn) return;
  btn.hidden = !("Notification" in window);
}



/* ---------- 4. OUTILS TEMPS RÉEL ---------- */
function joinChannel(channel, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Connexion en direct impossible.")), ms || 8000);

    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(err || new Error("Connexion en direct impossible."));
      }
    });
  });
}

// Attend que l'appareil ait trouvé ses « adresses » réseau avant d'envoyer l'appel
function waitForIce(pc, ms) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }

    const timer = setTimeout(done, ms || 4000);

    function check() {
      if (pc.iceGatheringState === "complete") done();
    }

    function done() {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    }

    pc.addEventListener("icegatheringstatechange", check);
  });
}

function setCallBadge(state, text) {
  const badge = $("callBadge");
  if (!badge) return;
  badge.dataset.state = state;
  badge.textContent = text;
}

/* ---------- 5. DÉMARRAGE / ARRÊT ---------- */
let liveStarted = false;
let liveCompanyId = null;
let bookingsChannel = null;
let ringChannel = null;

async function startLive() {
  if (liveStarted) return;
  liveStarted = true;

  refreshNotifButton();
  setCallBadge("wait", "Connexion aux appels en cours...");

  try {
    const company = await ensureCompany();
    liveCompanyId = company.id;

    // Réservations des clients : nouvelles, modifiées, annulées
    bookingsChannel = supabaseClient
      .channel("live-bookings-" + company.id)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "bookings",
        filter: "company_id=eq." + company.id
      }, onBookingChange)
      .subscribe(onLiveStatus);

    // Appels entrants
    try { await supabaseClient.realtime.setAuth(); } catch (error) {}

    ringChannel = supabaseClient
      .channel("ring:" + company.id, { config: { private: true } })
      .on("broadcast", { event: "ring" }, (msg) => onRing(msg.payload))
      .on("broadcast", { event: "ring-cancel" }, (msg) => onRingCancel(msg.payload));

    await joinChannel(ringChannel);
    setCallBadge("ok", "Prêt à recevoir des appels");
  } catch (error) {
    console.error("Temps réel :", error);
    setCallBadge("off", "Appels indisponibles (voir la configuration)");
    scheduleReconnect();
  }
}

function stopLive() {
  liveStarted = false;
  liveCompanyId = null;

  stopRing();
  clearIncoming();
  endCall(true, "");

  if (bookingsChannel) supabaseClient.removeChannel(bookingsChannel);
  if (ringChannel) supabaseClient.removeChannel(ringChannel);
  bookingsChannel = null;
  ringChannel = null;

  const box = $("toasts");
  if (box) box.innerHTML = "";

  setCallBadge("off", "Déconnecté");
}

document.addEventListener("bookflow:ready", startLive);
document.addEventListener("bookflow:logout", stopLive);

/* ---------- 5 bis. SURVEILLANCE DE LA CONNEXION ---------- */
function onLiveStatus(status) {
  if (!liveStarted) return; // arrêt volontaire : on ne fait rien

  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    setCallBadge("wait", "Reconnexion...");
    scheduleReconnect();
  }
}

let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (call) return; // pas pendant un appel

    // Ne relance que si l'utilisateur est toujours connecté
    supabaseClient.auth.getSession().then(({ data }) => {
      if (!data || !data.session) return;
      stopLive();
      startLive();
    });
  }, 3000);
}

// Au retour sur l'onglet, on vérifie que tout est encore connecté
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !liveStarted || call) return;

  const bad = (ch) => !ch || ch.state !== "joined";
  if (bad(bookingsChannel) || bad(ringChannel)) {
    stopLive();
    startLive();
  }
});

/* ---------- 6. RÉSERVATION D'UN CLIENT : NOUVELLE, MODIFIÉE, ANNULÉE ---------- */
async function onBookingChange(payload) {
  const b = payload.new;
  if (!b) return;

  // Les réservations ajoutées par l'entreprise elle-même ne déclenchent pas d'alerte
  if (!b.client_user_id) return;

  let title = null;
  let kind = "success";

  if (payload.eventType === "INSERT") {
    title = "Nouvelle réservation";
  } else if (payload.eventType === "UPDATE" && b.updated_by === "client") {
    const old = payload.old || {};

    if (b.status === "cancelled" && old.status !== "cancelled") {
      title = "Réservation annulée";
      kind = "warn";
    } else if (old.booking_date && old.booking_date !== b.booking_date) {
      title = "Réservation modifiée";
      kind = "warn";
    }
  }

  if (!title) return;

  await loadCustomers();
  await loadBookings();

  const customer = customers.find((c) => c.id === b.customer_id);
  const when = new Date(b.booking_date).toLocaleString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
  });
  const service = String(b.description || "").split("\n")[0];

  alertUser(
    title,
    (customer ? customer.name : "Un client") + " : " + when + (service ? " (" + service + ")" : ""),
    kind,
    {
      actions: [{
        label: "Voir",
        onClick: () => $("bookingsSection").scrollIntoView({ behavior: "smooth" })
      }]
    }
  );
}

/* ---------- 7. APPELS ENTRANTS ---------- */
let incoming = null; // appel qui sonne
let call = null;     // appel en cours

function onRing(p) {
  if (!p || !p.callId || !p.offer) return;

  // Déjà en ligne : on répond « occupé »
  if (call || incoming) {
    replyOnCall(p.callId, "busy");
    return;
  }

  incoming = Object.assign({}, p, { timer: setTimeout(missedCall, 45000) });

  $("incomingName").textContent = p.name || "Un client";
  $("incomingPhone").textContent = p.phone || "";
  $("incomingCall").hidden = false;

  startRing();
  bumpTitle();
  browserNotify("Appel entrant", (p.name || "Un client") + " vous appelle");
}

function onRingCancel(p) {
  if (incoming && p && incoming.callId === p.callId) missedCall();
}

function clearIncoming() {
  if (incoming) clearTimeout(incoming.timer);
  incoming = null;
  stopRing();
  const box = $("incomingCall");
  if (box) box.hidden = true;
}

function missedCall() {
  if (!incoming) return;
  const who = incoming;
  clearIncoming();

  showToast({
    title: "Appel manqué",
    text: (who.name || "Un client") + (who.phone ? " (" + who.phone + ")" : ""),
    kind: "warn",
    sticky: true
  });
}
async function replyOnCall(callId, event) {
  try {
    const channel = supabaseClient.channel(
      "call:" + liveCompanyId + ":" + callId, { config: { private: true } });
    await joinChannel(channel);
    await channel.send({ type: "broadcast", event: event, payload: {} });
    setTimeout(() => supabaseClient.removeChannel(channel), 1500);
  } catch (error) {
    console.error(error);
  }
}

$("declineBtn").addEventListener("click", () => {
  if (!incoming) return;
  const callId = incoming.callId;
  clearIncoming();
  replyOnCall(callId, "declined");
});

$("answerBtn").addEventListener("click", answerIncoming);

async function answerIncoming() {
  const inc = incoming;
  if (!inc) return;

  clearTimeout(inc.timer);
  incoming = null;
  stopRing();
  $("incomingCall").hidden = true;

  let stream = null;
  let pc = null;
  let channel = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (e) => {
      const audio = $("remoteAudio");
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };

    await pc.setRemoteDescription(inc.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    channel = supabaseClient.channel(
      "call:" + liveCompanyId + ":" + inc.callId, { config: { private: true } });
    channel.on("broadcast", { event: "hangup" }, () => endCall(false, "Le client a raccroché."));
    await joinChannel(channel);

    call = {
      callId: inc.callId, pc: pc, stream: stream, channel: channel,
      who: inc, startedAt: null, timer: null, muted: false
    };

    pc.onconnectionstatechange = () => {
      if (!call || call.pc !== pc) return;

      if (pc.connectionState === "connected" && !call.startedAt) {
        call.startedAt = Date.now();
        call.timer = setInterval(updateCallTimer, 1000);
        updateCallTimer();
      }

      if (pc.connectionState === "failed") {
        endCall(true, "La connexion de l’appel a été perdue.");
      }
    };

    await channel.send({
      type: "broadcast",
      event: "answer",
      payload: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }
    });

    showCallBar();
  } catch (error) {
    console.error("Appel :", error);

    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (pc) pc.close();
    if (channel) supabaseClient.removeChannel(channel);
    call = null;

    const denied = error && (error.name === "NotAllowedError" || error.name === "NotFoundError");
    showToast({
      title: "Appel impossible",
      text: denied
        ? "Autorisez le micro dans votre navigateur pour répondre aux appels."
        : "La connexion n’a pas pu s’établir.",
      kind: "error"
    });

    replyOnCall(inc.callId, "declined");
  }
}

/* ---------- 8. APPEL EN COURS ---------- */
function showCallBar() {
  $("callWho").textContent = (call.who.name || "Client") + (call.who.phone ? " · " + call.who.phone : "");
  $("callTimer").textContent = "Connexion…";
  $("muteBtn").textContent = "Couper le micro";
  $("callBar").hidden = false;
  document.body.classList.add("in-call");
}

function updateCallTimer() {
  if (!call || !call.startedAt) return;
  const s = Math.floor((Date.now() - call.startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  $("callTimer").textContent = mm + ":" + ss;
}

function endCall(notifyRemote, message) {
  if (!call) return;

  const c = call;
  call = null;

  if (notifyRemote && c.channel) {
    try { c.channel.send({ type: "broadcast", event: "hangup", payload: {} }); } catch (error) {}
  }

  clearInterval(c.timer);
  try { c.stream.getTracks().forEach((t) => t.stop()); } catch (error) {}
  try { c.pc.close(); } catch (error) {}
  setTimeout(() => { try { supabaseClient.removeChannel(c.channel); } catch (error) {} }, 800);

  const audio = $("remoteAudio");
  if (audio) audio.srcObject = null;

  const bar = $("callBar");
  if (bar) bar.hidden = true;
  document.body.classList.remove("in-call");

  if (message) showToast({ title: "Appel terminé", text: message, kind: "info" });
}

$("hangupBtn").addEventListener("click", () => {
  const duration = $("callTimer").textContent;
  endCall(true, /^\d\d:\d\d$/.test(duration) ? "Durée : " + duration : "");
});

$("muteBtn").addEventListener("click", () => {
  if (!call) return;
  call.muted = !call.muted;
  call.stream.getAudioTracks().forEach((t) => { t.enabled = !call.muted; });
  $("muteBtn").textContent = call.muted ? "Réactiver le micro" : "Couper le micro";
});

// Pendant l'appel, on reste sur le tableau de bord pour noter les informations
$("callAddClient").addEventListener("click", () => {
  if (!call) return;
  const who = call.who;

  $("customerName").value = who.name || "";
  $("customerEmail").value = who.email || "";
  $("customerPhone").value = who.phone || "";

  $("clientsSection").scrollIntoView({ behavior: "smooth" });
  $("customerName").focus();
});

$("callAddBooking").addEventListener("click", () => {
  if (!call) return;

  $("bookingCustomer").value = call.who.name || "";

  $("bookingsSection").scrollIntoView({ behavior: "smooth" });
  $("bookingDate").focus();
});
