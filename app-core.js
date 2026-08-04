// app-core.js
// -----------------------------------------------------------------------------
// Skupna infrastruktura: tema, pomožne funkcije, prijava/odjava, avtorizacijska
// zaščita (guard), stranska vrstica (shell) in pomočnik za modalna okna.
// Uvažajo jo app.js, app-pages.js in admin.js.
// -----------------------------------------------------------------------------

import {
  auth, db, ADMIN_EMAILS,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInAnonymously, signOut,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
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
export function addFloatingThemeToggle() {
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
      <img src="spletar-icon.svg" alt="Spletar" class="logo-img" />
      <span>Spletar<small>Nadzorna plošča</small></span>
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
export function bindModal(id) {
  const scrim = document.getElementById(id);
  if (!scrim) return { open() {}, close() {} };
  const close = () => scrim.classList.remove("show");
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  scrim.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", close));
  return { open: () => scrim.classList.add("show"), close };
}

