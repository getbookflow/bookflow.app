// ===== BookFlow : app.js (version 2) =====
// Fichiers liés : live.js (alertes et appels en direct) et admin.js (administration)

/* ---------- 1. CONNEXION SUPABASE ---------- */
const SUPABASE_URL = "https://sdtjktonilnazzuynloy.supabase.co";
const SUPABASE_KEY = "sb_publishable_nJVppgYq0gbgk0zjPc1Ixg_XaOQaopt"; // clé publique : normal dans le code

// Vrai si l'utilisateur arrive depuis le lien « mot de passe oublié » reçu par e-mail
let recoveryMode = /[#&]type=recovery/.test(window.location.hash);

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- 2. OUTILS ---------- */
const $ = (id) => document.getElementById(id);

// Protège contre l'injection de code dans les textes affichés
function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// Affiche un message : type "err" (rouge), "ok" (vert) ou "" (neutre)
function setMsg(el, text, type) {
  el.textContent = text || "";
  el.dataset.type = type || "";
}

// Traduit les erreurs de Supabase en phrases claires en français
function friendlyError(error) {
  const m = String((error && error.message) || error || "");
  if (/invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(m)) return "Confirmez d’abord votre adresse e-mail (regardez votre boîte mail).";
  if (/already registered|already been registered/i.test(m)) return "Un compte existe déjà avec cet e-mail. Connectez-vous.";
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

// Message court à l'écran (utilise live.js si présent, sinon une alerte)
function info(title, text, kind) {
  if (typeof showToast === "function") {
    showToast({ title: title, text: text || "", kind: kind || "success" });
  } else {
    alert(title + (text ? " : " + text : ""));
  }
}

/* ---------- 3. ÉTAT DE L'APPLICATION ---------- */
let selectedCurrency = "USD";
let selectedLanguage = "fr";
let exchangeRates = { USD: 1 };

let customers = [];
let employees = [];
let bookings = [];
let currentSubscription = null;
let selectedPlan = null;
let selectedCalendarDay = null;
let calendarDate = new Date();
let companyCache = null;

// Prix de base en USD
const plans = { Starter: 9, Business: 19, Premium: 39 };

const planFeatures = {
  Starter: {
    advancedStats: false, bookingHistory: false, multipleEmployees: false,
    activityReports: false, multipleLocations: false, advancedTeams: false,
    detailedReports: false, prioritySupport: false
  },
  Business: {
    advancedStats: true, bookingHistory: true, multipleEmployees: true,
    activityReports: true, multipleLocations: false, advancedTeams: false,
    detailedReports: false, prioritySupport: false
  },
  Premium: {
    advancedStats: true, bookingHistory: true, multipleEmployees: true,
    activityReports: true, multipleLocations: true, advancedTeams: true,
    detailedReports: true, prioritySupport: true
  }
};

// Un abonnement doit être actif ET non expiré
function canUseFeature(feature) {
  if (!currentSubscription) return false;

  const status = String(currentSubscription.status || "").toLowerCase();
  const plan = String(currentSubscription.plan || "").trim();

  if (status !== "active") return false;

  if (currentSubscription.expires_at &&
      new Date(currentSubscription.expires_at) < new Date()) {
    return false;
  }

  const features = planFeatures[plan];
  return !!features && features[feature] === true;
}

function updatePlanFeatures() {
  const advancedStats = $("advancedStats");
  const activityReports = $("activityReports");

  if (advancedStats) {
    const ok = canUseFeature("advancedStats");
    advancedStats.hidden = !ok;
    advancedStats.style.display = ok ? "block" : "none";
  }

  if (activityReports) {
    const ok = canUseFeature("activityReports");
    activityReports.hidden = !ok;
    activityReports.style.display = ok ? "block" : "none";
  }

  displayBookingHistory();
}

/* ---------- 4. LANGUE, DEVISES ET PRIX ---------- */
const translations = {
  fr: {
    welcome: "Gérez votre entreprise partout dans le monde.",
    description: "La plateforme intelligente pour gérer vos clients et réservations.",
    dashboard: "Tableau de bord",
    clients: "Clients",
    bookings: "Réservations",
    add: "Ajouter un client",
    pricing: "Nos abonnements",
    pricingDescription: "Un prix international unique, converti dans votre devise.",
    payment: "Paiements internationaux",
    paymentDescription: "Plusieurs moyens de paiement seront disponibles selon votre pays.",
    paymentStatus: "Les paiements réels seront activés après configuration.",
    choose: "Choisir",
    popular: "POPULAIRE",
    perMonth: "mois",
    planChosen: "Abonnement choisi"
  },
  en: {
    welcome: "Manage your business anywhere in the world.",
    description: "The smart platform to manage your clients and bookings.",
    dashboard: "Dashboard",
    clients: "Customers",
    bookings: "Bookings",
    add: "Add a customer",
    pricing: "Our subscriptions",
    pricingDescription: "One international price, converted into your currency.",
    payment: "International payments",
    paymentDescription: "Multiple payment methods will be available depending on your country.",
    paymentStatus: "Real payments will be activated after configuration.",
    choose: "Choose",
    popular: "POPULAR",
    perMonth: "month",
    planChosen: "Selected plan"
  }
};

async function loadExchangeRates() {
  const status = $("exchangeStatus");

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!response.ok) throw new Error("Exchange rate service unavailable");

    const data = await response.json();
    if (data.result !== "success") throw new Error("Exchange rate error");

    exchangeRates = data.rates;

    status.textContent = selectedLanguage === "fr"
      ? "Taux de change actualisés : " + data.time_last_update_utc
      : "Exchange rates updated: " + data.time_last_update_utc;

    updatePrices();
  } catch (error) {
    status.textContent = selectedLanguage === "fr"
      ? "Taux indisponibles. Affichage en USD uniquement."
      : "Rates unavailable. Displaying USD only.";

    selectedCurrency = "USD";
    $("currency").value = "USD";
    updatePrices();
  }
}

function updatePrices() {
  const rate = exchangeRates[selectedCurrency];
  if (!rate) return;

  const t = translations[selectedLanguage];

  for (const plan in plans) {
    const formatted = new Intl.NumberFormat(
      selectedLanguage === "fr" ? "fr-FR" : "en-US",
      { style: "currency", currency: selectedCurrency }
    ).format(plans[plan] * rate);

    $("price-" + plan).textContent = formatted + " / " + t.perMonth;
  }
}

function changeCurrency() {
  selectedCurrency = $("currency").value;
  updatePrices();
}

function changeLanguage() {
  selectedLanguage = $("language").value;
  const t = translations[selectedLanguage];

  document.documentElement.lang = selectedLanguage;

  $("welcome").textContent = t.welcome;
  $("description").textContent = t.description;
  $("dashboardTitle").textContent = t.dashboard;
  $("clientsLabel").textContent = t.clients;
  $("bookingsLabel").textContent = t.bookings;
  $("addButton").textContent = t.add;
  $("pricingTitle").textContent = t.pricing;
  $("pricingDescription").textContent = t.pricingDescription;
  $("paymentTitle").textContent = t.payment;
  $("paymentDescription").textContent = t.paymentDescription;
  $("paymentStatus").textContent = t.paymentStatus;
  $("popular").textContent = t.popular;

  for (const plan in plans) {
    $("button-" + plan).textContent = t.choose + " " + plan;
  }

  updatePrices();
}

/* ---------- 5. TABLEAU DE BORD ---------- */
function updateDashboard() {
  $("clients").textContent = customers.length;
  $("bookings").textContent = bookings.length;
}

// Le bouton du tableau de bord mène au formulaire d'ajout de client
function addClient() {
  $("customerForm").scrollIntoView({ behavior: "smooth" });
  $("customerName").focus();
}

/* ---------- 6. ENTREPRISE ---------- */
async function ensureCompany() {
  if (companyCache) return companyCache;

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Utilisateur non connecté.");

  const user = userData.user;

  // Les comptes créés sur la page de réservation sont des comptes clients
  if (user.user_metadata?.role === "client") {
    throw new Error("Ceci est un compte client. Connectez-vous avec votre compte entreprise.");
  }

  const { data: existing, error: searchError } = await supabaseClient
    .from("companies")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (searchError) throw searchError;

  if (existing) {
    companyCache = existing;
    return existing;
  }

  const { data: created, error: insertError } = await supabaseClient
    .from("companies")
    .insert({
      name: user.user_metadata?.company_name || "Mon entreprise",
      owner_id: user.id
    })
    .select()
    .single();

  if (insertError) throw insertError;

  companyCache = created;
  return created;
}

async function loadPublicBookingLink() {
  const input = $("publicBookingLink");
  const button = $("copyBookingLink");
  const message = $("bookingLinkMessage");

  if (!input || !button || !message) return;

  try {
    const company = await ensureCompany();

    const url = new URL("reserver.html", window.location.href);
    url.searchParams.set("company", company.id);
    input.value = url.href;

    button.onclick = async function () {
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (error) {
        input.select();
        document.execCommand("copy");
      }
      setMsg(message, "Lien copié !", "ok");
    };
  } catch (error) {
    setMsg(message, "Erreur : " + friendlyError(error), "err");
  }
}

/* ---------- 7. CLIENTS ---------- */
async function loadCustomers() {
  try {
    const company = await ensureCompany();

    const { data, error } = await supabaseClient
      .from("customers")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    customers = data || [];
    displayCustomers();
  } catch (error) {
    info("Chargement impossible", friendlyError(error), "error");
  }
}

function displayCustomers() {
  const list = $("customerList");
  list.innerHTML = "";

  customers.forEach((customer) => {
    const card = document.createElement("div");
    card.className = "customer-card";

    const name = document.createElement("h4");
    name.textContent = customer.name;

    const email = document.createElement("p");
    email.textContent = customer.email || "";

    const phone = document.createElement("p");
    phone.textContent = customer.phone || "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "delete-customer";
    button.textContent = "Supprimer";

    button.onclick = async function () {
      if (!confirm("Supprimer ce client ?")) return;

      try {
        const company = await ensureCompany();

        const { error } = await supabaseClient
          .from("customers")
          .delete()
          .eq("id", customer.id)
          .eq("company_id", company.id);

        if (error) throw error;

        await loadCustomers();
        displayBookings();
        renderCalendar();
      } catch (error) {
        info("Erreur", friendlyError(error), "error");
      }
    };

    card.append(name, email, phone, button);
    list.appendChild(card);
  });

  updateDashboard();
  updateActivityReports();
}

$("customerForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = this;

  await withLoading(submitBtn(event), async () => {
    try {
      const company = await ensureCompany();

      const { error } = await supabaseClient.from("customers").insert({
        company_id: company.id,
        name: $("customerName").value.trim(),
        email: $("customerEmail").value.trim(),
        phone: $("customerPhone").value.trim()
      });

      if (error) throw error;

      form.reset();
      await loadCustomers();
      info("Client ajouté", "", "success");
    } catch (error) {
      info("Erreur", friendlyError(error), "error");
    }
  });
});

/* ---------- 8. SERVICES ---------- */
async function loadServices() {
  const list = $("servicesList");
  if (!list) return;

  try {
    const company = await ensureCompany();

    const { data, error } = await supabaseClient
      .from("company_services")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    list.innerHTML = "";

    (data || []).forEach((service) => {
      const card = document.createElement("div");

      card.innerHTML = `
        <h3>${esc(service.name)}</h3>
        <p>${esc(service.description || "Aucune description")}</p>
        <p>Prix : ${esc(service.price)}</p>
        <p>Durée : ${esc(service.duration_minutes)} minutes</p>
        <button type="button" class="editServiceBtn">Modifier</button>
        <button type="button" class="deleteServiceBtn">Supprimer</button>
      `;

      card.querySelector(".editServiceBtn").addEventListener("click", async function () {
        const name = prompt("Nouveau nom :", service.name);
        if (name === null) return;

        const description = prompt("Nouvelle description :", service.description || "");
        if (description === null) return;

        const price = prompt("Nouveau prix :", service.price);
        if (price === null) return;

        const duration = prompt("Nouvelle durée en minutes :", service.duration_minutes);
        if (duration === null) return;

        if (
          !name.trim() ||
          !Number.isFinite(Number(price)) || Number(price) < 0 ||
          !Number.isInteger(Number(duration)) || Number(duration) < 1
        ) {
          info("Vérifiez les informations saisies", "", "error");
          return;
        }

        try {
          const { error } = await supabaseClient
            .from("company_services")
            .update({
              name: name.trim(),
              description: description.trim(),
              price: Number(price),
              duration_minutes: Number(duration)
            })
            .eq("id", service.id)
            .eq("company_id", company.id);

          if (error) throw error;

          info("Service modifié", "", "success");
          await loadServices();
        } catch (error) {
          info("Erreur", friendlyError(error), "error");
        }
      });

      card.querySelector(".deleteServiceBtn").addEventListener("click", async function () {
        if (!confirm("Voulez-vous vraiment supprimer ce service ?")) return;

        try {
          const { error } = await supabaseClient
            .from("company_services")
            .delete()
            .eq("id", service.id)
            .eq("company_id", company.id);

          if (error) throw error;

          info("Service supprimé", "", "success");
          await loadServices();
        } catch (error) {
          info("Erreur", friendlyError(error), "error");
        }
      });

      list.appendChild(card);
    });
  } catch (error) {
    console.error("Erreur services :", error);
  }
}

const serviceForm = $("serviceForm");

if (serviceForm) {
  serviceForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = this;

    await withLoading(submitBtn(event), async () => {
      try {
        const company = await ensureCompany();

        const { error } = await supabaseClient.from("company_services").insert({
          company_id: company.id,
          name: $("serviceName").value.trim(),
          description: $("serviceDescription").value.trim(),
          price: Number($("servicePrice").value),
          duration_minutes: Number($("serviceDuration").value)
        });

        if (error) throw error;

        form.reset();
        $("serviceDuration").value = 30;
        await loadServices();
        info("Service ajouté", "", "success");
      } catch (error) {
        info("Erreur", friendlyError(error), "error");
      }
    });
  });
}

/* ---------- 9. EMPLOYÉS (Business et Premium) ---------- */
async function loadEmployees() {
  const section = $("employeeSection");
  const list = $("employeeList");

  if (!section || !list) return;

  const hasAccess = canUseFeature("multipleEmployees");
  section.hidden = !hasAccess;

  if (!hasAccess) return;

  const hasAdvancedTeams = canUseFeature("advancedTeams");
  const advancedTeamFields = $("advancedTeamFields");
  if (advancedTeamFields) advancedTeamFields.hidden = !hasAdvancedTeams;

  try {
    const company = await ensureCompany();

    const { data, error } = await supabaseClient
      .from("employees")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    employees = data || [];
    list.innerHTML = "";

    if (employees.length === 0) {
      list.textContent = "Aucun employé enregistré.";
      return;
    }

    employees.forEach((employee) => {
      const card = document.createElement("div");
      card.className = "customer-card";

      const name = document.createElement("h4");
      name.textContent = employee.name;

      const email = document.createElement("p");
      email.textContent = employee.email || "";

      const phone = document.createElement("p");
      phone.textContent = employee.phone || "";

      const position = document.createElement("p");
      position.textContent = employee.position || "";

      const role = document.createElement("p");
      role.textContent = "Rôle : " + (employee.role || "Non défini");
      role.hidden = !hasAdvancedTeams;

      const responsibilities = document.createElement("p");
      responsibilities.textContent =
        "Responsabilités : " + (employee.responsibilities || "Non définies");
      responsibilities.hidden = !hasAdvancedTeams;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Supprimer";
      button.className = "delete-customer";

      button.onclick = async function () {
        if (!confirm("Supprimer cet employé ?")) return;

        const { error } = await supabaseClient
          .from("employees")
          .delete()
          .eq("id", employee.id)
          .eq("company_id", employee.company_id);

        if (error) {
          info("Erreur", friendlyError(error), "error");
          return;
        }

        await loadEmployees();
      };

      card.append(name, email, phone, position, role, responsibilities, button);
      list.appendChild(card);
    });
  } catch (error) {
    setMsg($("employeeMessage"), "Erreur : " + friendlyError(error), "err");
  }
}

$("employeeForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = this;
  const message = $("employeeMessage");

  await withLoading(submitBtn(event), async () => {
    try {
      const company = await ensureCompany();

      const employee = {
        company_id: company.id,
        name: $("employeeName").value.trim(),
        email: $("employeeEmail").value.trim(),
        phone: $("employeePhone").value.trim(),
        position: $("employeePosition").value.trim()
      };

      // Rôle et responsabilités : réservés au forfait Premium
      if (canUseFeature("advancedTeams")) {
        employee.role = $("employeeRole").value;
        employee.responsibilities = $("employeeResponsibilities").value.trim();
      }

      const { error } = await supabaseClient.from("employees").insert(employee);
      if (error) throw error;

      form.reset();
      setMsg(message, "Employé ajouté avec succès !", "ok");
      await loadEmployees();
    } catch (error) {
      setMsg(message, "Erreur : " + friendlyError(error), "err");
    }
  });
});

/* ---------- 10. ABONNEMENT ---------- */
async function loadSubscription() {
  const infoBox = $("subscriptionInfo");

  try {
    infoBox.textContent = "Chargement de votre abonnement...";

    const company = await ensureCompany();

    const { data, error } = await supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("company_id", company.id)
      .maybeSingle();

    if (error) throw error;

    currentSubscription = data;
    updatePlanFeatures();

    if (!data) {
      infoBox.textContent = "Aucun abonnement actif.";
    } else {
      const expired = data.expires_at && new Date(data.expires_at) < new Date();

      infoBox.textContent =
        "Forfait : " + data.plan +
        " | Statut : " + (expired ? "expiré" : data.status) +
        (data.expires_at
          ? " | Valable jusqu'au : " + new Date(data.expires_at).toLocaleDateString("fr-FR")
          : "");
    }

    return currentSubscription;
  } catch (error) {
    console.error("Erreur abonnement :", error);
    infoBox.textContent = "Erreur : " + friendlyError(error);
    currentSubscription = null;
    updatePlanFeatures();
    return null;
  }
}

function subscribe(plan) {
  selectedPlan = plan;

  const t = translations[selectedLanguage];
  const amount = $("price-" + plan).textContent;

  $("selectedPlanText").textContent = t.planChosen + " : " + plan + " — " + amount;

  const section = $("paymentRequestSection");
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth" });
}

/* ---------- 11. RÉSERVATIONS ---------- */
async function loadBookings() {
  try {
    const company = await ensureCompany();

    const { data, error } = await supabaseClient
      .from("bookings")
      .select("*")
      .eq("company_id", company.id)
      .order("booking_date", { ascending: true });

    if (error) throw error;

    bookings = data || [];
    displayBookings();
    renderCalendar();
    displayBookingHistory();
  } catch (error) {
    info("Chargement des réservations impossible", friendlyError(error), "error");
  }
}

function isSameDay(dateValue, year, month, day) {
  const d = new Date(dateValue);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
}

function displayBookings() {
  const list = $("bookingList");
  list.innerHTML = "";

  const filtered = selectedCalendarDay
    ? bookings.filter((b) =>
        isSameDay(b.booking_date, selectedCalendarDay.year, selectedCalendarDay.month, selectedCalendarDay.day))
    : bookings;

  filtered.forEach((booking) => {
    const card = document.createElement("div");
    card.className = "booking-card";

    const customer = customers.find((c) => c.id === booking.customer_id);

    const name = document.createElement("h4");
    name.textContent = customer ? customer.name : "Client introuvable";

    const date = document.createElement("p");
    date.textContent = new Date(booking.booking_date).toLocaleString("fr-FR");

    const description = document.createElement("p");
    description.textContent = booking.description || "";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Modifier";

    editButton.onclick = async function () {
      const pad = (n) => String(n).padStart(2, "0");
      const d = new Date(booking.booking_date);
      const oldDate = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const oldTime = pad(d.getHours()) + ":" + pad(d.getMinutes());

      const newDate = prompt("Nouvelle date (AAAA-MM-JJ) :", oldDate);
      if (!newDate) return;

      const newTime = prompt("Nouvelle heure (HH:MM) :", oldTime);
      if (!newTime) return;

      const newDescription = prompt("Nouvelle description :", booking.description || "");
      if (newDescription === null) return;

      const newBookingDate = new Date(newDate + "T" + newTime);

      if (isNaN(newBookingDate.getTime())) {
        info("Date ou heure invalide", "", "error");
        return;
      }

      try {
        const company = await ensureCompany();

        const { error } = await supabaseClient
          .from("bookings")
          .update({
            booking_date: newBookingDate.toISOString(),
            description: newDescription
          })
          .eq("id", booking.id)
          .eq("company_id", company.id);

        if (error) throw error;

        await loadBookings();
        info("Réservation modifiée", "", "success");
      } catch (error) {
        info("Erreur", friendlyError(error), "error");
      }
    };

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Supprimer";

    deleteButton.onclick = async function () {
      if (!confirm("Supprimer cette réservation ?")) return;

      try {
        const company = await ensureCompany();

        const { error } = await supabaseClient
          .from("bookings")
          .delete()
          .eq("id", booking.id)
          .eq("company_id", company.id);

        if (error) throw error;

        await loadBookings();
      } catch (error) {
        info("Erreur", friendlyError(error), "error");
      }
    };

    card.append(name, date, description, editButton, deleteButton);
    list.appendChild(card);
  });

  updateDashboard();
  updateAdvancedStats();
  updateActivityReports();
}

function updateAdvancedStats() {
  const now = new Date();

  const monthly = bookings.filter((b) => {
    const d = new Date(b.booking_date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const upcoming = bookings.filter((b) => new Date(b.booking_date) >= now);

  $("monthlyBookings").textContent = monthly.length;
  $("upcomingBookings").textContent = upcoming.length;
}

function displayBookingHistory() {
  const section = $("bookingHistorySection");
  const list = $("bookingHistory");

  if (!section || !list) return;

  const hasAccess = canUseFeature("bookingHistory");
  section.hidden = !hasAccess;

  if (!hasAccess) return;

  list.innerHTML = "";

  const now = new Date();

  const history = bookings
    .filter((b) => new Date(b.booking_date) < now)
    .sort((a, b) => new Date(b.booking_date) - new Date(a.booking_date));

  if (history.length === 0) {
    list.textContent = "Aucune ancienne réservation.";
    return;
  }

  history.forEach((booking) => {
    const card = document.createElement("div");
    card.className = "customer-card";

    const customer = customers.find((c) => c.id === booking.customer_id);

    const title = document.createElement("h4");
    title.textContent = customer ? customer.name : "Client introuvable";

    const date = document.createElement("p");
    date.textContent = new Date(booking.booking_date).toLocaleString("fr-FR");

    const description = document.createElement("p");
    description.textContent = booking.description || "";

    card.append(title, date, description);
    list.appendChild(card);
  });
}

function updateActivityReports() {
  const section = $("activityReports");
  const clientsElement = $("reportClients");
  const bookingsElement = $("reportBookings");
  const monthlyElement = $("monthlyActivity");

  if (!section || !clientsElement || !bookingsElement || !monthlyElement) return;

  if (!canUseFeature("activityReports")) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  clientsElement.textContent = customers.length;
  bookingsElement.textContent = bookings.length;

  const monthlyCounts = {};

  bookings.forEach((booking) => {
    const d = new Date(booking.booking_date);
    if (isNaN(d.getTime())) return;

    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
  });

  monthlyElement.innerHTML = "";

  const sortedMonths = Object.keys(monthlyCounts).sort();

  if (sortedMonths.length === 0) {
    monthlyElement.textContent = "Aucune réservation enregistrée.";
    return;
  }

  sortedMonths.forEach((key) => {
    const [year, month] = key.split("-");

    const label = new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

    const line = document.createElement("p");
    line.textContent = label + " : " + monthlyCounts[key] + " réservation(s)";
    monthlyElement.appendChild(line);
  });
}

$("bookingForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = this;

  await withLoading(submitBtn(event), async () => {
    try {
      const company = await ensureCompany();

      const customerName = $("bookingCustomer").value.trim();

      const customer = customers.find(
        (c) => c.name.toLowerCase() === customerName.toLowerCase()
      );

      if (!customer) {
        info("Ce client n’existe pas", "Ajoutez-le d’abord dans la gestion des clients.", "error");
        return;
      }

      const bookingDate = new Date($("bookingDate").value + "T" + $("bookingTime").value);

      if (isNaN(bookingDate.getTime())) {
        info("Date ou heure invalide", "", "error");
        return;
      }

      const { error } = await supabaseClient.from("bookings").insert({
        company_id: company.id,
        customer_id: customer.id,
        booking_date: bookingDate.toISOString(),
        description: $("bookingDescription").value.trim()
      });

      if (error) throw error;

      form.reset();
      await loadBookings();
      info("Réservation ajoutée", "", "success");
    } catch (error) {
      info("Erreur", friendlyError(error), "error");
    }
  });
});

/* ---------- 12. CALENDRIER ---------- */
function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  $("calendarMonth").textContent = calendarDate.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric"
  });

  const calendar = $("calendarDays");
  calendar.innerHTML = "";

  ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].forEach((day) => {
    const element = document.createElement("div");
    element.textContent = day;
    calendar.appendChild(element);
  });

  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < offset; i++) {
    calendar.appendChild(document.createElement("div"));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day;

    const bookingsOfDay = bookings.filter((b) => isSameDay(b.booking_date, year, month, day));

    bookingsOfDay.forEach((booking) => {
      const customer = customers.find((c) => c.id === booking.customer_id);

      const infoSpan = document.createElement("span");
      infoSpan.textContent =
        (customer ? customer.name : "Client") + " " +
        new Date(booking.booking_date).toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit"
        });

      infoSpan.style.display = "block";
      infoSpan.style.fontSize = "10px";
      button.appendChild(infoSpan);
    });

    if (bookingsOfDay.length > 0) {
      button.style.backgroundColor = "#4CAF50";
      button.style.color = "white";
    }

    button.onclick = () => showDayBookings(year, month, day);
    calendar.appendChild(button);
  }
}

// On repart toujours du 1er du mois (évite le saut du 31 au mois suivant)
function changeMonth(amount) {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + amount, 1);
  renderCalendar();
}

function showDayBookings(year, month, day) {
  selectedCalendarDay = { year, month, day };
  displayBookings();

  const button = $("showAllBookings");
  if (button) button.hidden = false;
}

/* ---------- 13. PAIEMENT MVOLA ---------- */
$("paymentRequestForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = this;
  const message = $("paymentRequestMessage");

  if (!selectedPlan) {
    setMsg(message, "Choisissez d’abord un abonnement.", "err");
    return;
  }

  await withLoading(submitBtn(event), async () => {
    try {
      const company = await ensureCompany();

      const { error } = await supabaseClient.from("payment_requests").insert({
        company_id: company.id,
        customer_name: $("paymentCustomerName").value.trim(),
        customer_phone: $("paymentPhone").value.trim(),
        payment_reference: $("paymentReference").value.trim(),
        plan: selectedPlan,
        amount: $("price-" + selectedPlan).textContent,
        status: "pending"
      });

      if (error) throw error;

      setMsg(message, "Demande envoyée ! Votre paiement sera vérifié rapidement.", "ok");
      form.reset();
    } catch (error) {
      setMsg(message, "Erreur : " + friendlyError(error), "err");
    }
  });
});

/* ---------- 14. CONNEXION, INSCRIPTION, DÉCONNEXION ---------- */
const signupForm = $("signupForm");
const loginForm = $("loginForm");
const resetForm = $("resetForm");
const recoveryForm = $("recoveryForm");
const authMessage = $("authMessage");
const logoutButton = $("logoutButton");

// Affiche un seul groupe de formulaires : "login", "reset", "recovery" ou "none"
function showAuthForms(which) {
  loginForm.hidden = which !== "login";
  signupForm.hidden = which !== "login";
  resetForm.hidden = which !== "reset";
  recoveryForm.hidden = which !== "recovery";
}

// Charge toutes les données après connexion (l'ordre compte : clients avant réservations)
async function loadAllData() {
  await ensureCompany();
  await loadSubscription();
  await loadCustomers();
  await Promise.all([
    loadBookings(),
    loadServices(),
    loadEmployees(),
    loadPublicBookingLink()
  ]);
}

// Appelée quand l'utilisateur est connecté : live.js et admin.js démarrent alors
function showLoggedIn() {
  showAuthForms("none");
  logoutButton.hidden = false;
  document.dispatchEvent(new Event("bookflow:ready"));
}

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!isValidEmail(email)) {
    setMsg(authMessage, "Adresse e-mail invalide.", "err");
    return;
  }

  if (!password) {
    setMsg(authMessage, "Entrez votre mot de passe.", "err");
    return;
  }

  setMsg(authMessage, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      companyCache = null;
      await loadAllData();

      setMsg(authMessage, "Connexion réussie ! Bienvenue sur BookFlow.", "ok");
      showLoggedIn();
      loginForm.reset();
    } catch (error) {
      // Un compte client ne peut pas ouvrir le tableau de bord entreprise
      if (/compte client/i.test(error.message || "")) {
        await supabaseClient.auth.signOut();
      }
      setMsg(authMessage, friendlyError(error), "err");
    }
  });
});

signupForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  const form = this;

  const companyName = $("companyName").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;

  if (companyName.length < 2) {
    setMsg(authMessage, "Entrez le nom de votre entreprise.", "err");
    return;
  }

  if (!isValidEmail(email)) {
    setMsg(authMessage, "Adresse e-mail invalide.", "err");
    return;
  }

  if (password.length < 6) {
    setMsg(authMessage, "Le mot de passe doit contenir au moins 6 caractères.", "err");
    return;
  }

  setMsg(authMessage, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { company_name: companyName } }
      });

      if (error) throw error;

      // Supabase renvoie un utilisateur sans identité quand l'e-mail existe déjà
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error("already registered");
      }

      if (data.session) {
        companyCache = null;
        await loadAllData();
        setMsg(authMessage, "Compte créé ! Bienvenue sur BookFlow.", "ok");
        showLoggedIn();
      } else {
        setMsg(authMessage, "Compte créé ! Vérifiez votre e-mail pour confirmer votre inscription.", "ok");
      }

      form.reset();
    } catch (error) {
      setMsg(authMessage, friendlyError(error), "err");
    }
  });
});

// On vide tout ce qui appartenait à l'utilisateur
function resetAppState() {
  companyCache = null;
  customers = [];
  employees = [];
  bookings = [];
  currentSubscription = null;
  selectedPlan = null;
  selectedCalendarDay = null;

  displayCustomers();
  displayBookings();
  renderCalendar();
  updatePlanFeatures();

  $("employeeSection").hidden = true;
  $("employeeList").innerHTML = "";
  setMsg($("employeeMessage"), "");
  $("servicesList").innerHTML = "";
  $("publicBookingLink").value = "";
  setMsg($("bookingLinkMessage"), "");
  $("subscriptionInfo").textContent = "Connectez-vous pour voir votre abonnement.";
  $("paymentRequestSection").hidden = true;

  document.dispatchEvent(new Event("bookflow:logout"));

  showAuthForms("login");
  logoutButton.hidden = true;
  setMsg(authMessage, "Vous êtes déconnecté.", "");
}

logoutButton.addEventListener("click", async function () {
  await withLoading(logoutButton, async () => {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      setMsg(authMessage, friendlyError(error), "err");
      return;
    }

    resetAppState();
  });
});

/* ---------- 15. MOT DE PASSE OUBLIÉ ---------- */
function showRecoveryForm() {
  showAuthForms("recovery");
  setMsg(authMessage, "Choisissez votre nouveau mot de passe.", "");
  $("authSection").scrollIntoView({ behavior: "smooth" });
}

$("forgotLink").addEventListener("click", function () {
  setMsg(authMessage, "");
  $("resetEmail").value = $("loginEmail").value;
  showAuthForms("reset");
});

$("backToLogin").addEventListener("click", function () {
  setMsg(authMessage, "");
  showAuthForms("login");
});

// Envoi du lien de réinitialisation par e-mail
resetForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const email = $("resetEmail").value.trim();

  if (!isValidEmail(email)) {
    setMsg(authMessage, "Adresse e-mail invalide.", "err");
    return;
  }

  setMsg(authMessage, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });

      if (error) throw error;

      setMsg(authMessage,
        "Si un compte existe avec cette adresse, un lien vient d’être envoyé. Vérifiez votre boîte mail.", "ok");
    } catch (error) {
      setMsg(authMessage, friendlyError(error), "err");
    }
  });
});

// Enregistrement du nouveau mot de passe
recoveryForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const password = $("newPassword").value;

  if (password.length < 6) {
    setMsg(authMessage, "Le mot de passe doit contenir au moins 6 caractères.", "err");
    return;
  }

  if (password !== $("newPassword2").value) {
    setMsg(authMessage, "Les deux mots de passe ne sont pas identiques.", "err");
    return;
  }

  setMsg(authMessage, "");

  await withLoading(submitBtn(event), async () => {
    try {
      const { error } = await supabaseClient.auth.updateUser({ password: password });
      if (error) throw error;

      recoveryMode = false;
      recoveryForm.reset();
      history.replaceState(null, "", window.location.pathname + window.location.search);

      companyCache = null;
      await loadAllData();
      setMsg(authMessage, "Mot de passe modifié. Bienvenue sur BookFlow.", "ok");
      showLoggedIn();
    } catch (error) {
      setMsg(authMessage, friendlyError(error), "err");
    }
  });
});

// Supabase prévient quand l'utilisateur arrive par le lien de réinitialisation
supabaseClient.auth.onAuthStateChange(function (event) {
  if (event === "PASSWORD_RECOVERY") {
    recoveryMode = true;
    showRecoveryForm();
  }
});

/* ---------- 16. THÈME CLAIR / SOMBRE ---------- */
const themeToggle = $("themeToggle");

try {
  if (localStorage.getItem("bookflowTheme") === "dark") {
    document.body.classList.add("dark-theme");
  }
} catch (error) {}

function updateThemeButton() {
  if (!themeToggle) return;
  const isDark = document.body.classList.contains("dark-theme");
  themeToggle.textContent = isDark ? "☀️ Mode clair" : "🌙 Mode sombre";
}

if (themeToggle) {
  updateThemeButton();

  themeToggle.addEventListener("click", function () {
    document.body.classList.toggle("dark-theme");
    const isDark = document.body.classList.contains("dark-theme");

    try {
      localStorage.setItem("bookflowTheme", isDark ? "dark" : "light");
    } catch (error) {}

    updateThemeButton();
  });
}

/* ---------- 17. DÉMARRAGE ---------- */
updateDashboard();
renderCalendar();
loadExchangeRates();

// Si l'utilisateur est déjà connecté (rechargement de la page), on recharge ses données
supabaseClient.auth.getSession().then(async ({ data }) => {
  if (recoveryMode) { showRecoveryForm(); return; }
  if (!data || !data.session) return;

  try {
    await loadAllData();
    showLoggedIn();
    setMsg(authMessage, "Bienvenue sur BookFlow.", "");
  } catch (error) {
    setMsg(authMessage, friendlyError(error), "err");
  }
});
