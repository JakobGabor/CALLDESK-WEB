// app.js
// -----------------------------------------------------------------------------
// Skupna logika: prijava/odjava, avtorizacijska zaščita, stranska vrstica (shell),
// ter moduli Dashboard / Cold Calli / Anketa / Beležke / Naloge.
// Datoteka admin.js uvozi { guard } in pomožne funkcije od tukaj.
// -----------------------------------------------------------------------------

import {
  auth, db, ADMIN_EMAILS,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInAnonymously, signOut,
  collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, increment,
} from "./firebase.js";

/* =========================================================================
   TEMA (svetla / temna) — izbira se shrani v brskalnik
   ========================================================================= */
const THEME_KEY = "calldesk-theme";

function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || "dark"; }
  catch { return "dark"; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}
// Uporabi shranjeno temo takoj ob nalaganju (prepreči utripanje).
applyTheme(getTheme());

// Poveže gumb (v shellu ali plavajočega): nastavi ikono in preklop ob kliku.
function attachThemeToggle(btn) {
  if (!btn) return;
  const setIcon = () => { btn.textContent = getTheme() === "light" ? "🌙" : "☀️"; };
  setIcon();
  btn.addEventListener("click", () => {
    applyTheme(getTheme() === "light" ? "dark" : "light");
    setIcon();
  });
}
// Plavajoči gumb (za strani brez stranske vrstice, npr. prijava).
function addFloatingThemeToggle() {
  if (document.getElementById("themeToggle")) return;
  const b = document.createElement("button");
  b.id = "themeToggle";
  b.type = "button";
  b.className = "theme-toggle";
  b.setAttribute("aria-label", "Preklopi temo");
  document.body.appendChild(b);
  attachThemeToggle(b);
}

/* =========================================================================
   POMOŽNE FUNKCIJE (izvožene tudi za admin.js)
   ========================================================================= */
export function toast(msg, type = "ok") {
  const box = document.getElementById("toastBox");
  if (!box) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(10px)"; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function statusClass(status) {
  const map = {
    "Poklicano": "s-poklicano",
    "Ni odgovora": "s-ni-odgovora",
    "Pokliči kasneje": "s-poklici-kasneje",
    "Zainteresiran": "s-zainteresiran",
    "Ni zainteresiran": "s-ni-zainteresiran",
  };
  return map[status] || "";
}

export function statusBadge(status) {
  const s = status || "Ni klicano";
  return `<span class="badge ${statusClass(s)}">${escapeHtml(s)}</span>`;
}

export function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!d) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* =========================================================================
   UPORABNIK + ADMIN STATUS
   ========================================================================= */
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  let snap;
  try { snap = await getDoc(ref); } catch { snap = null; }
  const isAdminEmail = user.email && ADMIN_EMAILS.includes(user.email);
  const name = user.email ? user.email.split("@")[0] : "Gost";

  if (!snap || !snap.exists()) {
    try {
      await setDoc(ref, {
        email: user.email || null,
        name,
        anonymous: user.isAnonymous || false,
        role: isAdminEmail ? "admin" : "user",
        createdAt: serverTimestamp(),
      });
    } catch { /* pravila lahko preprečijo – ni kritično */ }
    return { name, isAdmin: !!isAdminEmail, role: isAdminEmail ? "admin" : "user" };
  }
  const data = snap.data();
  return {
    name: data.name || name,
    isAdmin: data.role === "admin" || !!isAdminEmail,
    role: data.role || "user",
  };
}

/* =========================================================================
   STRANSKA VRSTICA (shell) — enaka na vseh zaščitenih straneh
   ========================================================================= */
const NAV = [
  { href: "dashboard.html", icon: "🏠", label: "Dashboard", page: "dashboard" },
  { href: "coldcalls.html", icon: "📞", label: "Cold Calli", page: "coldcalls" },
  { href: "notes.html",     icon: "📝", label: "Beležke",    page: "notes" },
  { href: "tasks.html",     icon: "✅", label: "Naloge",     page: "tasks" },
];

function renderShell(page, user, info) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  const initial = (info.name || "?").charAt(0).toUpperCase();
  const adminLink = info.isAdmin
    ? `<a href="admin.html" class="nav-admin ${page === "admin" ? "active" : ""}" style="display:flex">
         <span class="ic">🛡️</span> Admin
       </a>` : "";

  el.innerHTML = `
    <div class="brand">
      <span class="logo">C</span>
      <span>CallDesk<small>Nadzorna plošča</small></span>
    </div>
    <nav class="nav">
      ${NAV.map(n => `
        <a href="${n.href}" class="${page === n.page ? "active" : ""}">
          <span class="ic">${n.icon}</span> ${n.label}
        </a>`).join("")}
      ${adminLink}
    </nav>
    <div class="side-user">
      <div class="avatar">${initial}</div>
      <div class="who">
        <b>${escapeHtml(info.name)}</b>
        <span>${info.isAdmin ? "Administrator" : (user.isAnonymous ? "Gost" : "Uporabnik")}</span>
      </div>
      <button class="btn sm ghost theme-mini" id="themeBtn" title="Preklopi temo">☀️</button>
      <button class="btn sm ghost" id="logoutBtn" title="Odjava">⎋</button>
    </div>`;

  attachThemeToggle(document.getElementById("themeBtn"));

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    location.replace("index.html");
  });
}

function wireShell() {
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  const menu = document.getElementById("menuBtn");
  const open = () => { sidebar?.classList.add("open"); scrim?.classList.add("show"); };
  const close = () => { sidebar?.classList.remove("open"); scrim?.classList.remove("show"); };
  menu?.addEventListener("click", open);
  scrim?.addEventListener("click", close);
  sidebar?.addEventListener("click", e => { if (e.target.tagName === "A") close(); });
}

// Univerzalna zaščita: preusmeri neprijavljene, pripravi shell, pokliči onReady enkrat.
export function guard(page, onReady) {
  let started = false;
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace("index.html"); return; }
    if (started) return;
    started = true;
    const info = await ensureUserDoc(user);
    renderShell(page, user, info);
    wireShell();
    onReady(user, info);
  });
}

/* =========================================================================
   MODAL — mali pomočnik
   ========================================================================= */
function bindModal(id) {
  const scrim = document.getElementById(id);
  if (!scrim) return { open() {}, close() {} };
  const close = () => scrim.classList.remove("show");
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  scrim.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", close));
  return { open: () => scrim.classList.add("show"), close };
}

/* =========================================================================
   STRAN: PRIJAVA
   ========================================================================= */
function initLogin() {
  addFloatingThemeToggle();

  // Če je uporabnik že prijavljen → naravnost na dashboard.
  onAuthStateChanged(auth, (user) => { if (user) location.replace("dashboard.html"); });

  const tabLogin = document.getElementById("tabLogin");
  const tabReg = document.getElementById("tabRegister");
  const form = document.getElementById("authForm");
  const btn = document.getElementById("authBtn");
  const msg = document.getElementById("authMsg");
  const sub = document.getElementById("authSub");
  let mode = "login";

  const setMode = (m) => {
    mode = m;
    tabLogin.classList.toggle("on", m === "login");
    tabReg.classList.toggle("on", m === "register");
    btn.textContent = m === "login" ? "Prijava" : "Ustvari račun";
    sub.textContent = m === "login" ? "Prijavi se in nadaljuj s klici." : "Ustvari nov račun za dostop.";
    msg.textContent = "";
  };
  tabLogin.addEventListener("click", () => setMode("login"));
  tabReg.addEventListener("click", () => setMode("register"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const pass = document.getElementById("password").value;
    msg.className = "form-msg";
    msg.textContent = "";
    btn.disabled = true;
    try {
      if (mode === "login") await signInWithEmailAndPassword(auth, email, pass);
      else await createUserWithEmailAndPassword(auth, email, pass);
      location.replace("dashboard.html");
    } catch (err) {
      btn.disabled = false;
      msg.className = "form-msg err";
      msg.textContent = friendlyAuthError(err);
    }
  });

  document.getElementById("guestBtn").addEventListener("click", async () => {
    msg.className = "form-msg";
    try {
      await signInAnonymously(auth);
      location.replace("dashboard.html");
    } catch (err) {
      msg.className = "form-msg err";
      msg.textContent = "Anonimna prijava ni omogočena v Firebase. " + friendlyAuthError(err);
    }
  });
}

function friendlyAuthError(err) {
  const c = err?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Napačna e-pošta ali geslo.";
  if (c.includes("email-already-in-use")) return "Ta e-pošta je že v uporabi.";
  if (c.includes("weak-password")) return "Geslo mora imeti vsaj 6 znakov.";
  if (c.includes("invalid-email")) return "Neveljavna e-pošta.";
  if (c.includes("network")) return "Napaka povezave. Preveri internet.";
  if (c.includes("configuration") || c.includes("api-key"))
    return "Firebase ni pravilno nastavljen (preveri firebase.js).";
  return "Napaka: " + (err?.message || "poskusi znova.");
}

/* =========================================================================
   STRAN: DASHBOARD (hitri pregled)
   ========================================================================= */
function initDashboard() {
  onSnapshot(collection(db, "companies"), (snap) => {
    document.getElementById("sCompanies").textContent = snap.size;
  });
  onSnapshot(collection(db, "responses"), (snap) => {
    let interested = 0;
    snap.forEach(d => { if (d.data().interested === "Da" || d.data().status === "Zainteresiran") interested++; });
    document.getElementById("sCalls").textContent = snap.size;
    document.getElementById("sInterested").textContent = interested;
  });
  onSnapshot(collection(db, "tasks"), (snap) => {
    let open = 0;
    snap.forEach(d => { if (d.data().column !== "done") open++; });
    document.getElementById("sTasks").textContent = open;
  });
}

/* =========================================================================
   STRAN: COLD CALLI (tabela podjetij)
   ========================================================================= */
function initColdCalls() {
  const tbody = document.getElementById("companyRows");
  const searchEl = document.getElementById("companySearch");
  const filterEl = document.getElementById("companyStatusFilter");
  const modal = bindModal("companyModal");
  let companies = [];

  onSnapshot(collection(db, "companies"), (snap) => {
    companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    companies.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sl"));
    render();
  }, () => {
    tbody.innerHTML = `<tr><td colspan="7" class="sub">Napaka pri nalaganju. Preveri Firebase nastavitve.</td></tr>`;
  });

  function render() {
    const q = (searchEl.value || "").toLowerCase().trim();
    const fs = filterEl.value;
    const list = companies.filter(c => {
      const hay = `${c.name} ${c.activity} ${c.contact} ${c.city}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      const okS = !fs || (c.status || "Ni klicano") === fs;
      return okQ && okS;
    });

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="big">📞</div>Ni podjetij. Dodaj prvo z gumbom zgoraj.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td>${escapeHtml(c.activity) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.contact) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.city) || "<span class='sub'>—</span>"}</td>
        <td><span class="count-pill">${c.responseCount || 0}</span></td>
        <td>${statusBadge(c.status)}</td>
        <td style="text-align:right">
          <a class="btn sm primary" href="survey.html?company=${encodeURIComponent(c.id)}">Odpri anketo</a>
        </td>
      </tr>`).join("");
  }

  searchEl.addEventListener("input", render);
  filterEl.addEventListener("change", render);

  document.getElementById("addCompanyBtn").addEventListener("click", modal.open);
  document.getElementById("saveCompanyBtn").addEventListener("click", async () => {
    const name = document.getElementById("cName").value.trim();
    if (!name) { toast("Vnesi ime podjetja.", "err"); return; }
    try {
      await addDoc(collection(db, "companies"), {
        name,
        activity: document.getElementById("cActivity").value.trim(),
        contact: document.getElementById("cContact").value.trim(),
        city: document.getElementById("cCity").value.trim(),
        status: "Ni klicano",
        responseCount: 0,
        createdAt: serverTimestamp(),
      });
      ["cName", "cActivity", "cContact", "cCity"].forEach(id => document.getElementById(id).value = "");
      modal.close();
      toast("Podjetje dodano.");
    } catch (e) {
      toast("Napaka pri shranjevanju.", "err");
    }
  });
}

/* =========================================================================
   STRAN: ANKETA (obrazec + real-time zgodovina)
   ========================================================================= */
function initSurvey(user, info) {
  const params = new URLSearchParams(location.search);
  const companyId = params.get("company");
  const titleEl = document.getElementById("surveyTitle");
  const subEl = document.getElementById("surveySub");
  const form = document.getElementById("surveyForm");
  const msg = document.getElementById("surveyMsg");
  const listEl = document.getElementById("respList");
  const countEl = document.getElementById("respCount");

  if (!companyId) {
    subEl.textContent = "Manjka podjetje.";
    listEl.innerHTML = `<div class="empty">Ni izbranega podjetja. <a href="coldcalls.html" style="color:var(--accent)">Nazaj na seznam</a></div>`;
    return;
  }

  const companyRef = doc(db, "companies", companyId);
  let companyName = "Podjetje";

  getDoc(companyRef).then(snap => {
    if (snap.exists()) {
      const c = snap.data();
      companyName = c.name || "Podjetje";
      titleEl.textContent = companyName;
      subEl.innerHTML = `${escapeHtml(c.activity || "")} ${c.city ? "· " + escapeHtml(c.city) : ""} ${c.contact ? "· " + escapeHtml(c.contact) : ""}`.trim() || "Anketa";
    } else {
      titleEl.textContent = "Neznano podjetje";
      subEl.textContent = "To podjetje ne obstaja več.";
    }
  });

  // Real-time zgodovina odgovorov (brez orderBy → brez potrebe po indeksu; sort v JS)
  onSnapshot(query(collection(db, "responses"), where("companyId", "==", companyId)), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    countEl.textContent = rows.length;
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">Še ni odgovorov za to podjetje.</div>`;
      return;
    }
    listEl.innerHTML = rows.map(r => `
      <div class="card pad" style="margin-bottom:10px; padding:14px">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px">
          <b>${escapeHtml(r.name) || "Brez imena"}</b>
          ${statusBadge(r.status)}
        </div>
        <div class="sub" style="margin:6px 0">
          ${r.phone ? "📱 " + escapeHtml(r.phone) + " · " : ""}
          Javil: ${escapeHtml(r.answered || "—")} · Zanima: ${escapeHtml(r.interested || "—")}
        </div>
        ${r.comment ? `<div style="font-size:.88rem">${escapeHtml(r.comment)}</div>` : ""}
        <div class="sub" style="margin-top:8px">🕒 ${formatTs(r.createdAt)} · ${escapeHtml(r.userName || "uporabnik")}</div>
      </div>`).join("");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("saveSurveyBtn");
    const answered = form.querySelector('input[name="answered"]:checked')?.value || "";
    const interested = form.querySelector('input[name="interested"]:checked')?.value || "";
    const status = document.getElementById("fStatus").value;
    btn.disabled = true;
    msg.className = "form-msg";
    try {
      await addDoc(collection(db, "responses"), {
        companyId,
        companyName,
        name: document.getElementById("fName").value.trim(),
        phone: document.getElementById("fPhone").value.trim(),
        answered, interested,
        comment: document.getElementById("fComment").value.trim(),
        status,
        userId: user.uid,
        userName: info.name,
        createdAt: serverTimestamp(),
      });
      // Posodobi povzetek podjetja (viden vsem v realnem času)
      await updateDoc(companyRef, {
        responseCount: increment(1),
        status,
        lastContact: serverTimestamp(),
      });
      msg.className = "form-msg ok";
      msg.textContent = "Odgovor shranjen ✔";
      toast("Odgovor shranjen.");
      form.reset();
    } catch (err) {
      msg.className = "form-msg err";
      msg.textContent = "Napaka pri shranjevanju.";
      toast("Napaka pri shranjevanju.", "err");
    } finally {
      btn.disabled = false;
    }
  });
}

/* =========================================================================
   STRAN: BELEŽKE (skupne, samodejno shranjevanje, real-time)
   ========================================================================= */
function initNotes(user, info) {
  const grid = document.getElementById("notesGrid");
  const rendered = new Map(); // id -> { el, titleEl, textEl, stateEl }
  const timers = new Map();   // id -> debounce timer

  document.getElementById("addNoteBtn").addEventListener("click", async () => {
    try {
      await addDoc(collection(db, "notes"), {
        title: "Nova beležka",
        text: "",
        updatedBy: info.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast("Beležka dodana.");
    } catch { toast("Napaka pri dodajanju.", "err"); }
  });

  onSnapshot(collection(db, "notes"), (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // odstrani izbrisane
    const ids = new Set(items.map(i => i.id));
    for (const [id, r] of rendered) if (!ids.has(id)) { r.el.remove(); rendered.delete(id); }

    if (!items.length && !grid.querySelector(".note")) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">📝</div>Ni beležk. Ustvari prvo z gumbom zgoraj.</div>`;
      return;
    }
    // odstrani prazno stanje, če obstaja
    grid.querySelector(".empty")?.remove();

    for (const it of items) {
      if (rendered.has(it.id)) {
        const r = rendered.get(it.id);
        // ne prepiši polja, ki ga uporabnik trenutno ureja
        if (document.activeElement !== r.titleEl) r.titleEl.value = it.title || "";
        if (document.activeElement !== r.textEl) r.textEl.value = it.text || "";
        r.metaEl.textContent = `${formatTs(it.updatedAt)} · ${it.updatedBy || ""}`;
      } else {
        grid.appendChild(makeNote(it));
      }
    }
  }, () => {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Napaka pri nalaganju beležk.</div>`;
  });

  function makeNote(it) {
    const el = document.createElement("div");
    el.className = "note";
    el.innerHTML = `
      <input class="note-title" value="${escapeHtml(it.title || "")}" placeholder="Naslov" />
      <textarea placeholder="Piši tukaj…">${escapeHtml(it.text || "")}</textarea>
      <div class="note-foot">
        <span class="meta">${formatTs(it.updatedAt)} · ${escapeHtml(it.updatedBy || "")}</span>
        <span style="display:flex; align-items:center; gap:10px">
          <span class="save-state saved"><span class="dot"></span>shranjeno</span>
          <button class="del" title="Izbriši">🗑</button>
        </span>
      </div>`;
    const titleEl = el.querySelector(".note-title");
    const textEl = el.querySelector("textarea");
    const stateEl = el.querySelector(".save-state");
    const metaEl = el.querySelector(".meta");

    const save = () => {
      stateEl.className = "save-state saving"; stateEl.lastChild.textContent = "shranjujem…";
      clearTimeout(timers.get(it.id));
      timers.set(it.id, setTimeout(async () => {
        try {
          await updateDoc(doc(db, "notes", it.id), {
            title: titleEl.value, text: textEl.value,
            updatedBy: info.name, updatedAt: serverTimestamp(),
          });
          stateEl.className = "save-state saved"; stateEl.lastChild.textContent = "shranjeno";
        } catch { stateEl.className = "save-state"; stateEl.lastChild.textContent = "napaka"; }
      }, 600));
    };
    titleEl.addEventListener("input", save);
    textEl.addEventListener("input", save);

    el.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Izbrišem to beležko?")) return;
      try { await deleteDoc(doc(db, "notes", it.id)); toast("Beležka izbrisana."); }
      catch { toast("Napaka pri brisanju.", "err"); }
    });

    rendered.set(it.id, { el, titleEl, textEl, stateEl, metaEl });
    return el;
  }
}

/* =========================================================================
   STRAN: NALOGE (Kanban + drag & drop)
   ========================================================================= */
function initTasks(user, info) {
  const cols = ["todo", "doing", "done"];
  const zones = {}; cols.forEach(c => zones[c] = document.querySelector(`[data-drop="${c}"]`));
  let tasks = [];
  let addingIn = null; // stolpec z odprtim vnosnim poljem (blokira re-render)

  onSnapshot(collection(db, "tasks"), (snap) => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!addingIn) render();
  }, () => {
    cols.forEach(c => zones[c].innerHTML = `<div class="sub">Napaka pri nalaganju.</div>`);
  });

  function render() {
    cols.forEach(col => {
      const items = tasks.filter(t => (t.column || "todo") === col)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      document.querySelector(`[data-cnt="${col}"]`).textContent = items.length;
      zones[col].innerHTML = items.map(cardHtml).join("");
    });
    bindCards();
  }

  function cardHtml(t) {
    return `
      <div class="task" draggable="true" data-id="${t.id}">
        <div class="t-title">${escapeHtml(t.title)}</div>
        <div class="t-foot">
          <span class="t-date">${formatTs(t.createdAt)}</span>
          <button class="t-del" title="Izbriši">🗑</button>
        </div>
      </div>`;
  }

  function bindCards() {
    document.querySelectorAll(".task").forEach(card => {
      card.addEventListener("dragstart", () => card.classList.add("dragging"));
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.querySelector(".t-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await deleteDoc(doc(db, "tasks", card.dataset.id)); }
        catch { toast("Napaka pri brisanju.", "err"); }
      });
    });
  }

  // Drop cone
  cols.forEach(col => {
    const z = zones[col];
    z.addEventListener("dragover", (e) => { e.preventDefault(); z.parentElement.classList.add("drag-over"); });
    z.addEventListener("dragleave", () => z.parentElement.classList.remove("drag-over"));
    z.addEventListener("drop", async (e) => {
      e.preventDefault();
      z.parentElement.classList.remove("drag-over");
      const card = document.querySelector(".task.dragging");
      if (!card) return;
      const id = card.dataset.id;
      try {
        await updateDoc(doc(db, "tasks", id), { column: col, order: Date.now() });
      } catch { toast("Napaka pri premikanju.", "err"); }
    });
  });

  // Dodaj kartico (inline vnos)
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => openAdd(btn.dataset.add, btn));
  });

  function openAdd(col, btn) {
    if (addingIn) return;
    addingIn = col;
    const box = document.createElement("div");
    box.className = "task";
    box.style.cursor = "default";
    box.innerHTML = `<input placeholder="Naslov naloge…" style="border:none;background:transparent;padding:0;font-size:.9rem" />`;
    zones[col].appendChild(box);
    const input = box.querySelector("input");
    input.focus();

    const finish = async (save) => {
      const val = input.value.trim();
      addingIn = null;
      box.remove();
      if (save && val) {
        try {
          await addDoc(collection(db, "tasks"), {
            title: val, column: col, order: Date.now(),
            createdBy: info.name, createdAt: serverTimestamp(),
          });
        } catch { toast("Napaka pri dodajanju.", "err"); }
      }
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }
}

/* =========================================================================
   ROUTER — zaženi pravi modul glede na data-page
   ========================================================================= */
const PAGE = document.body?.dataset?.page;
if (PAGE === "login") initLogin();
else if (PAGE === "dashboard") guard(PAGE, initDashboard);
else if (PAGE === "coldcalls") guard(PAGE, initColdCalls);
else if (PAGE === "survey") guard(PAGE, initSurvey);
else if (PAGE === "notes") guard(PAGE, initNotes);
else if (PAGE === "tasks") guard(PAGE, initTasks);
// "admin" upravlja admin.js
