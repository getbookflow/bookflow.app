// ===== BookFlow : reserver.js =====
// Page publique des clients : connexion, réservation, mes rendez-vous.
// L'appel vocal est dans appel-client.js.

/* ---------- 1. CONNEXION SUPABASE ---------- */
const SUPABASE_URL = "https://sdtjktonilnazzuynloy.supabase.co";
const SUPABASE_KEY = "sb_publishable_nJVppgYq0gbgk0zjPc1Ixg_XaOQaopt"; // clé publique

// Vrai si le client arrive depuis le lien « mot de passe oublié » reçu par e-mail
let recoveryMode = /[#&]type=recovery/.test(window.location.hash);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- 2. OUTILS ---------- */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const companyId = params.get("company");

let companyName = "";
let companyReady = false;
let currentUser = null;
let services = [];
let showingTicket = false;
let sessionApplied = false;
let wasLoggedIn = false;

function say(el, text, type) {
  el.textContent = text || "";
  el.dataset.type = type || "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// Traduit les erreurs de Supabase en phrases claires en français
function friendly(error) {
  const m = String((error && error.message) || error || "");
  if (/invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(m)) return "Confirmez d’abord votre adresse e-mail (vérifiez votre boîte de réception).";
  if (/already registered|already been registered/i.test(m)) return "Un compte existe déjà avec cet e-mail. Connectez-vous.";
  // Créneau déjà pris par un autre client (règle « unique » dans Supabase)
  if (/bookings_unique_slot|duplicate key|unique constraint/i.test(m)) return "Ce créneau vient d’être réservé par un autre client. Choisissez une autre heure.";
  if (/unable to validate email|invalid email|email address.*invalid/i.test(m)) return "Adresse e-mail invalide.";
  if (/password.*(short|least|weak|characters)/i.test(m)) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/same password|different from the old/i.test(m)) return "Le nouveau mot de passe doit être différent de l’ancien.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Trop de tentatives. Réessayez dans quelques minutes.";
  if (/failed to fetch|network/i.test(m)) return "Connexion internet indisponible. Vérifiez votre réseau.";
  if (/session missing|expired|invalid.*token/i.test(m)) return "Le lien a expiré. Refaites une demande.";
  return m || "Une erreur est survenue.";
}

// Affiche un bouton « en chargement » (petit cercle qui tourne) pendant une action
async function withLoading(button, task) {
  if (!button) return task();

  button.classList.add("is-loading");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");

  try {
    return await task();
  } finally {
    button.classList.remove("is-loading");
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function submitBtn(event) {
  return event.submitter || event.target.querySelector('button[type="submit"]');
}

function initials(text) {
  const parts = String(text || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

function localDateString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

const fmtLongDate = (d) =>
  d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (d) =>
  d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/* ---------- 3. AFFICHAGE SELON L’ÉTAT ---------- */
function renderAll() {
  const loggedIn = !!currentUser;
  const recovering = recoveryMode;

  $("recoveryCard").hidden = !recovering;
  $("accountArea").hidden = !loggedIn || recovering;
  $("authCard").hidden = !companyReady || loggedIn || recovering;
  $("bookingCard").hidden = !companyReady || !loggedIn || showingTicket || recovering;
  $("ticketCard").hidden = !companyReady || !loggedIn || !showingTicket || recovering;
  $("callCard").hidden = !companyReady || !loggedIn || recovering;
  $("myBookingsCard").hidden = !companyReady || !loggedIn || recovering;

  if (recovering) {
    $("companyLead").textContent = "Choisissez votre nouveau mot de passe.";
    return;
  }

  if (!companyReady) return;

  if (loggedIn) {
    const meta = currentUser.user_metadata || {};
    const first = String(meta.full_name || "").trim().split(/\s+/)[0];
    $("companyLead").textContent =
      (first ? "Bonjour " + first + ". " : "") + "Choisissez un service et un horaire.";
  } else {
    $("companyLead").textContent = "Connectez-vous ou créez un compte pour réserver en quelques secondes.";
  }
}

function invalidLink(title, text) {
  companyReady = false;
  $("companyTitle").textContent = title;
  $("companyLead").textContent = text;
  renderAll();
}

/* ---------- 4. ENTREPRISE ET SERVICES ---------- */
async function loadCompany() {
  if (!companyId) {
    invalidLink("Lien invalide", "Demandez à l’entreprise de vous renvoyer son lien de réservation.");
    return;
  }

  try {
    const { data, error } = await sb.rpc("get_public_company_name", { p_company_id: companyId });
    if (error) throw error;

    if (!data) {
      invalidLink("Entreprise introuvable", "Ce lien de réservation n’est plus valable.");
      return;
    }

    companyName = data;
    companyReady = true;
    $("companyTitle").textContent = data;
    document.title = "Réserver chez " + data + " | BookFlow";
    renderAll();
  } catch (error) {
    console.error(error);
    invalidLink("Chargement impossible", "Vérifiez votre connexion, puis rechargez la page.");
  }
}

async function loadServices() {
  const list = $("serviceList");

  if (!companyId) return;

  try {
    const { data, error } = await sb.rpc("get_public_company_services", { p_company_id: companyId });
    if (error) throw error;

    services = data || [];
    list.replaceChildren();

    if (services.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Aucun service n’est disponible pour le moment.";
      list.appendChild(p);
      return;
    }

    services.forEach((service) => {
      const label = document.createElement("label");
      label.className = "service";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "service";
      input.value = String(service.service_id);
      input.required = true;

      const body = document.createElement("div");
      body.className = "body";

      const name = document.createElement("span");
      name.className = "s-name";
      name.textContent = service.service_name;

      const meta = document.createElement("span");
      meta.className = "s-meta";
      meta.textContent = service.duration_minutes + " min";

      const price = document.createElement("span");
      price.className = "s-price";
      price.textContent = new Intl.NumberFormat("fr-FR").format(Number(service.service_price));

      body.append(name, meta, price);
      label.append(input, body);
      list.appendChild(label);
    });
  } catch (error) {
    console.error("Erreur services :", error);
    list.textContent = "Impossible de charger les services.";
  }
}

/* ---------- 5. SESSION CLIENT ---------- */
function applySession(session) {
  sessionApplied = true;
  currentUser = session ? session.user : null;

  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    const display = meta.full_name || currentUser.email;

    $("avatar").textContent = initials(display);
    $("accountName").textContent = display;

    if (!$("bookingPhone").value && meta.phone) {
      $("bookingPhone").value = meta.phone;
    }

    loadMyBookings();

    if (!wasLoggedIn) document.dispatchEvent(new Event("bookflow:ready"));
    wasLoggedIn = true;
  } else {
    showingTicket = false;
    $("myBookings").replaceChildren();
    $("bookingForm").reset();
    say($("bookingMessage"), "");

    if (wasLoggedIn) document.dispatchEvent(new Event("bookflow:logout"));
    wasLoggedIn = false;
  }

  renderAll();
}

// Supabase prévient la page à chaque connexion / déconnexion
sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") recoveryMode = true;
  setTimeout(() => applySession(session), 0);
});

// Filet de sécurité si l’événement initial n’arrive pas
sb.auth.getSession().then(({ data }) => {
  if (!sessionApplied) applySession(data.session);
});

/* ---------- 6. CONNEXION / CRÉATION DE COMPTE ---------- */
function setTab(which) {
  const login = which === "login";
  $("tabLogin").setAttribute("aria-selected", String(login));
  $("tabSignup").setAttribute("aria-selected", String(!login));
  $("loginForm").hidden = !login;
  $("signupForm").hidden = login;
  $("resetForm").hidden = true;
  say($("authMessage"), "");
}

$("tabLogin").addEventListener("click", () => setTab("login"));
$("tabSignup").addEventListener("click", () => setTab("signup"));

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("authMessage");

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!isValidEmail(email)) {
    say(msg, "Adresse e-mail invalide.", "err");
    return;
  }

  if (!password) {
    say(msg, "Entrez votre mot de passe.", "err");
    return;
  }

  say(msg, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      $("loginForm").reset();
      say(msg, "");
    } catch (error) {
      say(msg, friendly(error), "err");
    }
  });
});

$("signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("authMessage");

  const fullName = $("signupName").value.trim();
  const phone = $("signupPhone").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;

  if (fullName.length < 2) {
    say(msg, "Entrez votre nom complet.", "err");
    return;
  }

  if (phone.replace(/\D/g, "").length < 6) {
    say(msg, "Entrez un numéro de téléphone valide.", "err");
    return;
  }

  if (!isValidEmail(email)) {
    say(msg, "Adresse e-mail invalide.", "err");
    return;
  }

  if (password.length < 6) {
    say(msg, "Le mot de passe doit contenir au moins 6 caractères.", "err");
    return;
  }

  say(msg, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.href,
          data: { role: "client", full_name: fullName, phone: phone }
        }
      });
      if (error) throw error;

      // Supabase renvoie un utilisateur sans identité quand l'e-mail existe déjà
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error("already registered");
      }

      $("signupForm").reset();

      if (data.session) {
        say(msg, "");
      } else {
        setTab("login");
        say(msg, "Compte créé. Confirmez votre adresse e-mail grâce au message que nous venons de vous envoyer, puis connectez-vous.", "ok");
      }
    } catch (error) {
      say(msg, friendly(error), "err");
    }
  });
});

$("logoutBtn").addEventListener("click", async (event) => {
  await withLoading(event.currentTarget, async () => {
    await sb.auth.signOut();
  });
});

/* ---------- 7. MOT DE PASSE OUBLIÉ ---------- */
$("forgotLink").addEventListener("click", () => {
  $("resetEmail").value = $("loginEmail").value;
  $("loginForm").hidden = true;
  $("signupForm").hidden = true;
  $("resetForm").hidden = false;
  say($("authMessage"), "");
});

$("backToLogin").addEventListener("click", () => setTab("login"));

$("resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("authMessage");
  const email = $("resetEmail").value.trim();

  if (!isValidEmail(email)) {
    say(msg, "Adresse e-mail invalide.", "err");
    return;
  }

  say(msg, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname + window.location.search
      });
      if (error) throw error;

      say(msg, "Si un compte existe avec cette adresse, un lien vient d’être envoyé. Vérifiez votre boîte mail.", "ok");
    } catch (error) {
      say(msg, friendly(error), "err");
    }
  });
});

$("recoveryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("recoveryMessage");
  const password = $("newPassword").value;

  if (password.length < 6) {
    say(msg, "Le mot de passe doit contenir au moins 6 caractères.", "err");
    return;
  }

  if (password !== $("newPassword2").value) {
    say(msg, "Les deux mots de passe ne sont pas identiques.", "err");
    return;
  }

  say(msg, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await sb.auth.updateUser({ password: password });
      if (error) throw error;

      recoveryMode = false;
      $("recoveryForm").reset();
      say(msg, "");
      history.replaceState(null, "", window.location.pathname + window.location.search);
      renderAll();
    } catch (error) {
      say(msg, friendly(error) + " Si le lien a expiré, refaites une demande.", "err");
    }
  });
});

/* ---------- 8. RÉSERVATION ---------- */
$("bookingDate").min = localDateString(new Date());

$("bookingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("bookingMessage");

  const checked = document.querySelector('input[name="service"]:checked');
  const service = checked ? services.find((s) => String(s.service_id) === checked.value) : null;

  if (!service) {
    say(msg, "Choisissez un service.", "err");
    return;
  }

  const when = new Date($("bookingDate").value + "T" + $("bookingTime").value);

  if (isNaN(when.getTime())) {
    say(msg, "Choisissez une date et une heure valides.", "err");
    return;
  }

  if (when <= new Date()) {
    say(msg, "Choisissez une date et une heure futures.", "err");
    return;
  }

  const phone = $("bookingPhone").value.trim();
  const notes = $("bookingNotes").value.trim();

  const description =
    "Service choisi : " + service.service_name + " (" + service.duration_minutes + " min)" +
    (notes ? "\n" + notes : "");

  say(msg, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await sb.rpc("create_client_booking", {
        p_company_id: companyId,
        p_phone: phone,
        p_booking_date: when.toISOString(),
        p_description: description
      });
      if (error) throw error;

      const meta = (currentUser && currentUser.user_metadata) || {};

      $("ticketCompany").textContent = companyName;
      $("tService").textContent = service.service_name;
      $("tDate").textContent = fmtLongDate(when);
      $("tTime").textContent = fmtTime(when);
      $("tDuration").textContent = service.duration_minutes + " min";
      $("tName").textContent = meta.full_name || (currentUser && currentUser.email) || "";

      $("bookingNotes").value = "";
      $("bookingTime").value = "";

      showingTicket = true;
      renderAll();
      $("ticketCard").scrollIntoView({ behavior: "smooth", block: "start" });

      loadMyBookings();
    } catch (error) {
      say(msg, friendly(error), "err");
    }
  });
});

$("newBookingBtn").addEventListener("click", () => {
  showingTicket = false;
  renderAll();
  $("bookingCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- 9. MES RENDEZ-VOUS ---------- */
function bookingRow(booking) {
  const when = new Date(booking.booking_date);
  const upcoming = when > new Date();

  const row = document.createElement("div");
  row.className = "item" + (upcoming ? "" : " past");

  const date = document.createElement("div");
  date.className = "date";
  const day = document.createElement("strong");
  day.textContent = when.getDate();
  const month = document.createElement("span");
  month.textContent = when.toLocaleDateString("fr-FR", { month: "short" });
  date.append(day, month);

  const info = document.createElement("div");

  const title = document.createElement("p");
  title.className = "item-title";
  title.textContent =
    when.toLocaleDateString("fr-FR", { weekday: "long" }) + " à " + fmtTime(when);

  const desc = document.createElement("p");
  desc.className = "item-desc";
  desc.textContent = booking.description || "";

  const chip = document.createElement("span");
  chip.className = "chip" + (upcoming ? "" : " muted");
  chip.textContent = upcoming ? "À venir" : "Terminé";

  info.append(title, desc, chip);

  if (upcoming) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = "Annuler ce rendez-vous";

    cancel.addEventListener("click", async () => {
      if (!confirm("Annuler ce rendez-vous ?")) return;

      cancel.disabled = true;

      try {
        const { error } = await sb.rpc("cancel_my_booking", {
          p_booking_id: String(booking.booking_id)
        });
        if (error) throw error;

        await loadMyBookings();
      } catch (error) {
        alert(friendly(error));
        cancel.disabled = false;
      }
    });

    info.appendChild(cancel);
  }

  row.append(date, info);
  return row;
}

async function loadMyBookings() {
  const list = $("myBookings");

  if (!currentUser || !companyId) return;

  try {
    const { data, error } = await sb.rpc("get_my_bookings", { p_company_id: companyId });
    if (error) throw error;

    list.replaceChildren();

    if (!data || data.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Vous n’avez pas encore de rendez-vous.";
      list.appendChild(p);
      return;
    }

    const now = new Date();
    const upcoming = data
      .filter((b) => new Date(b.booking_date) > now)
      .sort((a, b) => new Date(a.booking_date) - new Date(b.booking_date));
    const past = data
      .filter((b) => new Date(b.booking_date) <= now)
      .sort((a, b) => new Date(b.booking_date) - new Date(a.booking_date));

    upcoming.concat(past).forEach((b) => list.appendChild(bookingRow(b)));
  } catch (error) {
    console.error(error);
    list.textContent = "Impossible de charger vos rendez-vous.";
  }
}

/* ---------- 10. DÉMARRAGE ---------- */
loadCompany();
loadServices();
