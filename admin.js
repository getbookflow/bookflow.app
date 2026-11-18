// ===== BookFlow : admin.js =====
// Espace administrateur : revenus des abonnements et validation des paiements MVola.
// Utilise app.js (supabaseClient, $, plans, withLoading, friendlyError, info...) et live.js (alertUser).

let isAdmin = false;
let adminChannel = null;
let adminRequests = [];
let companyNames = {};

function money(amount) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(amount);
}

function planPrice(plan) {
  return plans[plan] || 0;
}

function companyLabel(id) {
  return companyNames[id] || "Entreprise " + String(id).slice(0, 8);
}

/* ---------- 1. DÉMARRAGE ---------- */
// Vérifie si l'utilisateur connecté est administrateur BookFlow
async function loadAdminDashboard() {
  try {
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) return;

    const { data, error } = await supabaseClient
      .from("bookflow_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return;

    isAdmin = true;
    $("adminSection").hidden = false;
    $("navAdmin").hidden = false;

    await loadPaymentRequests();
    listenForPayments();
  } catch (error) {
    console.error("Erreur administrateur :", error.message);
  }
}

function stopAdmin() {
  isAdmin = false;
  adminRequests = [];
  companyNames = {};

  if (adminChannel) supabaseClient.removeChannel(adminChannel);
  adminChannel = null;

  $("adminSection").hidden = true;
  $("navAdmin").hidden = true;
  $("adminStats").innerHTML = "";
  $("paymentRequestsList").innerHTML = "";
  $("paymentHistoryList").innerHTML = "";
}

document.addEventListener("bookflow:ready", loadAdminDashboard);
document.addEventListener("bookflow:logout", stopAdmin);

$("adminRefresh").addEventListener("click", (event) => {
  withLoading(event.currentTarget, loadPaymentRequests);
});

/* ---------- 2. ALERTE QUAND UNE ENTREPRISE ENVOIE UN PAIEMENT ---------- */
function listenForPayments() {
  if (adminChannel) return;

  adminChannel = supabaseClient
    .channel("admin-payments")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "payment_requests"
    }, async (payload) => {
      await loadPaymentRequests();

      const p = payload.new || {};
      const text = companyLabel(p.company_id) + " : " + (p.plan || "") + " (" + money(planPrice(p.plan)) + ")";

      if (typeof alertUser === "function") {
        alertUser("Nouveau paiement à valider", text, "warn", {
          sticky: true,
          actions: [{
            label: "Voir",
            onClick: () => $("adminSection").scrollIntoView({ behavior: "smooth" })
          }]
        });
      }
    })
    .subscribe();
}

/* ---------- 3. CHARGEMENT ET AFFICHAGE ---------- */
async function loadPaymentRequests() {
  const pendingList = $("paymentRequestsList");
  pendingList.textContent = "Chargement des demandes...";

  try {
    const { data, error } = await supabaseClient
      .from("payment_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    adminRequests = data || [];

    // Noms des entreprises (visibles seulement si la règle administrateur existe)
    companyNames = {};
    const ids = Array.from(new Set(adminRequests.map((p) => p.company_id)));

    if (ids.length > 0) {
      const { data: companies } = await supabaseClient
        .from("companies")
        .select("id, name")
        .in("id", ids);

      (companies || []).forEach((c) => { companyNames[c.id] = c.name; });
    }

    renderAdmin();
  } catch (error) {
    pendingList.textContent = "Erreur : " + friendlyError(error);
  }
}

function statBox(label, value, extraClass) {
  const box = document.createElement("div");
  box.className = "stat" + (extraClass ? " " + extraClass : "");

  const p = document.createElement("p");
  p.textContent = label;

  const h = document.createElement("h3");
  h.textContent = value;

  box.append(p, h);
  return box;
}

function renderAdmin() {
  const pending = adminRequests.filter((p) => p.status === "pending");
  const approved = adminRequests.filter((p) => p.status === "approved");
  const others = adminRequests.filter((p) => p.status !== "pending");

  const approvedTotal = approved.reduce((sum, p) => sum + planPrice(p.plan), 0);
  const pendingTotal = pending.reduce((sum, p) => sum + planPrice(p.plan), 0);

  // Revenus en premier
  const stats = $("adminStats");
  stats.innerHTML = "";
  stats.append(
    statBox("Revenus encaissés (abonnements validés)", money(approvedTotal), "stat-hero"),
    statBox("En attente de validation", money(pendingTotal) + " · " + pending.length + " demande(s)"),
    statBox("Abonnements validés", String(approved.length))
  );

  $("pendingCount").textContent = pending.length;

  const pendingList = $("paymentRequestsList");
  pendingList.innerHTML = "";

  if (pending.length === 0) {
    pendingList.textContent = "Aucune demande à valider pour le moment.";
  } else {
    pending.forEach((p) => pendingList.appendChild(requestCard(p, true)));
  }

  const history = $("paymentHistoryList");
  history.innerHTML = "";

  if (others.length === 0) {
    history.textContent = "Aucun historique.";
  } else {
    others.forEach((p) => history.appendChild(requestCard(p, false)));
  }
}

function requestCard(payment, withActions) {
  const card = document.createElement("div");
  card.className = "payment-request-card" + (withActions ? " pending" : "");

  const head = document.createElement("div");
  head.className = "pr-head";

  const title = document.createElement("h4");
  title.textContent = companyLabel(payment.company_id);

  const chip = document.createElement("span");
  chip.className = "chip" + (payment.status === "rejected" ? " bad" : "");
  chip.textContent = payment.plan + " · " + money(planPrice(payment.plan)) +
    (withActions ? "" : payment.status === "approved" ? " · validé" : " · refusé");

  head.append(title, chip);
  card.appendChild(head);

  const lines = [
    "Client : " + (payment.customer_name || ""),
    "Téléphone MVola : " + (payment.customer_phone || ""),
    "Référence : " + (payment.payment_reference || ""),
    "Montant affiché : " + (payment.amount || ""),
    payment.created_at ? "Envoyé le " + new Date(payment.created_at).toLocaleString("fr-FR") : ""
  ];

  lines.filter(Boolean).forEach((text) => {
    const p = document.createElement("p");
    p.className = "pr-line";
    p.textContent = text;
    card.appendChild(p);
  });

  if (withActions) {
    const actions = document.createElement("div");
    actions.className = "pr-actions";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn sm";
    approve.textContent = "Valider le paiement";
    approve.addEventListener("click", () => updatePaymentStatus(payment.id, "approved", approve));

    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn ghost sm";
    reject.textContent = "Refuser";
    reject.addEventListener("click", () => updatePaymentStatus(payment.id, "rejected", reject));

    actions.append(approve, reject);
    card.appendChild(actions);
  }

  return card;
}

/* ---------- 4. VALIDER OU REFUSER ---------- */
async function updatePaymentStatus(paymentId, newStatus, button) {
  const confirmation = confirm(
    newStatus === "approved"
      ? "Confirmer la validation de ce paiement ?"
      : "Confirmer le refus de ce paiement ?"
  );

  if (!confirmation) return;

  await withLoading(button, async () => {
    try {
      const { data: payment, error: paymentError } = await supabaseClient
        .from("payment_requests")
        .select("company_id, plan")
        .eq("id", paymentId)
        .single();

      if (paymentError) throw paymentError;

      // Paiement validé : on active le forfait pour 30 jours
      if (newStatus === "approved") {
        const { error: subscriptionError } = await supabaseClient
          .from("subscriptions")
          .upsert({
            company_id: payment.company_id,
            plan: payment.plan,
            status: "active",
            started_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: "company_id" });

        if (subscriptionError) throw subscriptionError;
      }

      const { error } = await supabaseClient
        .from("payment_requests")
        .update({ status: newStatus })
        .eq("id", paymentId);

      if (error) throw error;

      info(
        newStatus === "approved" ? "Paiement validé" : "Paiement refusé",
        newStatus === "approved" ? "L’abonnement est activé pour 30 jours." : "",
        newStatus === "approved" ? "success" : "info"
      );

      await loadPaymentRequests();
    } catch (error) {
      info("Erreur", friendlyError(error), "error");
    }
  });
}
