// ===== BookFlow : push.js (à charger après live.js) =====
// Utilise app.js : supabaseClient, $, ensureCompany, info, friendlyError

const VAPID_PUBLIC_KEY = "BM-5ux7y6AdE-PDZbVJ-cPzCLXsLCxmSMc1dxbBOyTtwEWI98ps9O1bIlGKc3YUaWh1sUuCyBGD3H6MN1bMn2R4";

function urlB64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush(silent) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (!silent) info("Notifications indisponibles",
      "Sur iPhone, ajoutez d’abord BookFlow à l’écran d’accueil.", "warn");
    return;
  }

  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;

    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY)
      }));

    const j = sub.toJSON();
    const company = await ensureCompany();

    const { error } = await supabaseClient.from("push_subscriptions").upsert({
      endpoint: j.endpoint,
      company_id: company.id,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth
    }, { onConflict: "endpoint" });

    if (error) throw error;
    if (!silent) info("Notifications activées", "Vous serez prévenu même onglet fermé.", "success");
  } catch (error) {
    console.error("Push :", error);
    if (!silent) info("Activation impossible", friendlyError(error), "error");
  }
}

// Clic sur « Activer les notifications »
$("enableNotifs").addEventListener("click", () => enablePush(false));

// À chaque connexion, on renouvelle l'abonnement en silence si déjà autorisé
document.addEventListener("bookflow:ready", () => {
  if ("Notification" in window && Notification.permission === "granted") enablePush(true);
});

// À AJOUTER dans index.html :
//   <link rel="manifest" href="manifest.json">
//   <script src="push.js"></script>   (après live.js)
