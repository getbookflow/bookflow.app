// ===== BookFlow : appel-client.js =====
// Appel vocal du client (page reserver.html) vers le tableau de bord de l'entreprise.
// Utilise reserver.js : sb, $, say, companyId, companyName, currentUser.

const CALL_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
];

let clientCall = null; // l'appel en cours (ou null)

/* ---------- OUTILS ---------- */
function newCallId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "c" + Date.now() + Math.random().toString(16).slice(2);
}

function joinCallChannel(channel, ms) {
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
function waitIce(pc, ms) {
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

function safeSend(channel, event, payload) {
  try {
    return Promise.resolve(
      channel.send({ type: "broadcast", event: event, payload: payload || {} })
    ).catch(() => {});
  } catch (error) {
    return Promise.resolve();
  }
}

/* ---------- BARRE D'APPEL ---------- */
function showClientCallBar() {
  $("callBarText").textContent = "Appel vers " + (companyName || "l’entreprise");
  $("callBarTimer").textContent = "Ça sonne…";
  $("callMute").hidden = true;
  $("callMute").textContent = "Couper le micro";
  $("callBar").hidden = false;
  document.body.classList.add("in-call");
}

function updateClientTimer() {
  if (!clientCall || !clientCall.startedAt) return;
  const s = Math.floor((Date.now() - clientCall.startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  $("callBarTimer").textContent = mm + ":" + ss;
}

/* ---------- DÉMARRER L'APPEL ---------- */
async function startClientCall() {
  const msg = $("callMessage");

  if (clientCall) return;

  if (!currentUser || !companyId) {
    say(msg, "Connectez-vous pour appeler l’entreprise.", "err");
    return;
  }

  if (!navigator.mediaDevices || !window.RTCPeerConnection) {
    say(msg, "Votre navigateur ne permet pas les appels. Essayez avec Chrome.", "err");
    return;
  }

  say(msg, "");
  $("callBtn").disabled = true;

  const c = {
    callId: newCallId(),
    state: "starting",
    pc: null,
    stream: null,
    callChannel: null,
    ringChannel: null,
    startedAt: null,
    timer: null,
    ringTimer: null,
    muted: false
  };
  clientCall = c;

  try {
    // 1. Le micro
    c.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (clientCall !== c) return; // annulé entre-temps

    // 2. La connexion audio
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    c.pc = pc;
    c.stream.getTracks().forEach((track) => pc.addTrack(track, c.stream));

    pc.ontrack = (e) => {
  const audio = $("remoteAudio");
  audio.srcObject = e.streams[0] || new MediaStream([e.track]);
  audio.muted = false;
  audio.volume = 1;
  audio.play().catch(() => {
    document.addEventListener("click", () => audio.play(), { once: true });
  });
};

    pc.onconnectionstatechange = () => {
      if (clientCall !== c) return;

      if (pc.connectionState === "connected" && !c.startedAt) {
        c.state = "connected";
        c.startedAt = Date.now();
        c.timer = setInterval(updateClientTimer, 1000);
        updateClientTimer();
        $("callMute").hidden = false;
      }

      if (pc.connectionState === "failed") {
        endClientCall(true, "La connexion de l’appel a été perdue.", "err");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    if (clientCall !== c) return;

    // 3. Les canaux privés
    try { await sb.realtime.setAuth(); } catch (error) {}

    c.callChannel = sb.channel(
      "call:" + companyId + ":" + c.callId, { config: { private: true } });

    c.callChannel
      .on("broadcast", { event: "answer" }, async (m) => {
        if (clientCall !== c || c.state !== "ringing") return;
        clearTimeout(c.ringTimer);
        c.state = "connecting";
        $("callBarTimer").textContent = "Connexion…";

        try {
          await pc.setRemoteDescription(m.payload.sdp);
        } catch (error) {
          console.error(error);
          endClientCall(true, "La connexion n’a pas pu s’établir.", "err");
        }
      })
      .on("broadcast", { event: "declined" }, () => {
        endClientCall(false, "L’entreprise ne peut pas répondre pour le moment.", "err");
      })
      .on("broadcast", { event: "busy" }, () => {
        endClientCall(false, "L’entreprise est déjà en ligne. Réessayez dans un instant.", "err");
      })
      .on("broadcast", { event: "hangup" }, () => {
        endClientCall(false, "L’entreprise a raccroché.", "");
      });

    await joinCallChannel(c.callChannel);
    if (clientCall !== c) return;

    c.ringChannel = sb.channel("ring:" + companyId, { config: { private: true } });
    await joinCallChannel(c.ringChannel);
    if (clientCall !== c) return;

    // 4. On fait sonner l'entreprise
    const meta = currentUser.user_metadata || {};
    const phone = meta.phone || ($("bookingPhone") ? $("bookingPhone").value.trim() : "");

    await c.ringChannel.send({
      type: "broadcast",
      event: "ring",
      payload: {
        callId: c.callId,
        offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        name: meta.full_name || currentUser.email || "Un client",
        phone: phone,
        email: currentUser.email || ""
      }
    });

    c.state = "ringing";
    showClientCallBar();

    // Sans réponse après 45 secondes, on arrête
    c.ringTimer = setTimeout(() => {
      endClientCall(true, "Personne n’a répondu. Réessayez plus tard ou réservez en ligne.", "");
    }, 45000);
  } catch (error) {
    console.error("Appel :", error);

    const denied = error && (error.name === "NotAllowedError" || error.name === "NotFoundError");
    const text = denied
      ? "Autorisez le micro dans votre navigateur pour appeler."
      : "L’appel n’a pas pu démarrer. Vérifiez votre connexion et réessayez.";

    if (clientCall === c) endClientCall(false, text, "err");
  }
}

/* ---------- TERMINER L'APPEL ---------- */
function endClientCall(notifyRemote, message, type) {
  const c = clientCall;
  if (!c) return;
  clientCall = null;

  clearTimeout(c.ringTimer);
  clearInterval(c.timer);

  const duration = c.startedAt ? $("callBarTimer").textContent : "";

  if (notifyRemote) {
    // L'entreprise sonne encore : on annule la sonnerie
    if (c.state === "ringing" && c.ringChannel) {
      safeSend(c.ringChannel, "ring-cancel", { callId: c.callId });
    }
    if (c.callChannel) safeSend(c.callChannel, "hangup", {});
  }

  try { if (c.stream) c.stream.getTracks().forEach((t) => t.stop()); } catch (error) {}
  try { if (c.pc) c.pc.close(); } catch (error) {}

  setTimeout(() => {
    try { if (c.callChannel) sb.removeChannel(c.callChannel); } catch (error) {}
    try { if (c.ringChannel) sb.removeChannel(c.ringChannel); } catch (error) {}
  }, 1000);

  const audio = $("remoteAudio");
  if (audio) audio.srcObject = null;

  $("callBar").hidden = true;
  document.body.classList.remove("in-call");
  $("callBtn").disabled = false;

  if (!message && /^\d\d:\d\d$/.test(duration)) {
    message = "Appel terminé. Durée : " + duration;
  }

  say($("callMessage"), message || "", message ? (type || "") : "");
}

/* ---------- BOUTONS ---------- */
$("callBtn").addEventListener("click", startClientCall);

$("callHangup").addEventListener("click", () => {
  endClientCall(true, "", "");
});

$("callMute").addEventListener("click", () => {
  if (!clientCall || !clientCall.stream) return;
  clientCall.muted = !clientCall.muted;
  clientCall.stream.getAudioTracks().forEach((t) => { t.enabled = !clientCall.muted; });
  $("callMute").textContent = clientCall.muted ? "Réactiver le micro" : "Couper le micro";
});

// Déconnexion du client ou fermeture de la page : on raccroche proprement
document.addEventListener("bookflow:logout", () => endClientCall(true, "", ""));
window.addEventListener("pagehide", () => endClientCall(true, "", ""));
