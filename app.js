// app.js
// -----------------------------------------------------------------------------
// Moduli: Prijava, Dashboard, Beležke, Naloge + usmerjevalnik (router).
// Skupna infrastruktura je v app-core.js, Cold Calli in Anketa v app-pages.js.
// -----------------------------------------------------------------------------

import {
  auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInAnonymously,
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from "./firebase.js";
import {
  guard, toast, escapeHtml, formatTs, addFloatingThemeToggle,
} from "./app-core.js";
import { initColdCalls, initSurvey } from "./app-pages.js";

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
   STRAN: BELEŽKE (skupne, samodejno shranjevanje, real-time)
   Kartice so predogled — klik odpre veliko okno za branje in urejanje.
   ========================================================================= */
function initNotes(user, info) {
  const grid = document.getElementById("notesGrid");
  let notes = [];        // vse beležke
  let openId = null;     // id trenutno odprte beležke
  let saveTimer = null;

  /* ---- Veliko okno (ustvari se enkrat) ---- */
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim note-scrim";
  scrim.innerHTML = `
    <div class="modal note-modal">
      <div class="note-modal-head">
        <input class="note-modal-title" placeholder="Naslov beležke" />
        <button class="note-modal-close" title="Zapri">✕</button>
      </div>
      <textarea class="note-modal-text" placeholder="Piši tukaj…"></textarea>
      <div class="note-modal-foot">
        <span class="save-state saved"><span class="dot"></span>shranjeno</span>
        <span style="display:flex; gap:10px">
          <button class="btn sm danger note-modal-del">🗑 Izbriši</button>
          <button class="btn sm primary note-modal-done">Končano</button>
        </span>
      </div>
    </div>`;
  document.body.appendChild(scrim);

  const mTitle = scrim.querySelector(".note-modal-title");
  const mText  = scrim.querySelector(".note-modal-text");
  const mState = scrim.querySelector(".save-state");

  const closeModal = () => {
    scrim.classList.remove("show");
    openId = null;
  };
  scrim.addEventListener("click", e => { if (e.target === scrim) closeModal(); });
  scrim.querySelector(".note-modal-close").addEventListener("click", closeModal);
  scrim.querySelector(".note-modal-done").addEventListener("click", closeModal);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && openId) closeModal();
  });

  scrim.querySelector(".note-modal-del").addEventListener("click", async () => {
    if (!openId) return;
    if (!confirm("Izbrišem to beležko?")) return;
    const id = openId;
    closeModal();
    try { await deleteDoc(doc(db, "notes", id)); toast("Beležka izbrisana."); }
    catch { toast("Napaka pri brisanju.", "err"); }
  });

  function openModal(id) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    openId = id;
    mTitle.value = n.title || "";
    mText.value = n.text || "";
    mState.className = "save-state saved";
    mState.lastChild.textContent = "shranjeno";
    scrim.classList.add("show");
    mText.focus();
  }

  /* ---- Samodejno shranjevanje iz velikega okna ---- */
  const saveOpen = () => {
    if (!openId) return;
    const id = openId;
    mState.className = "save-state saving";
    mState.lastChild.textContent = "shranjujem…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await updateDoc(doc(db, "notes", id), {
          title: mTitle.value,
          text: mText.value,
          updatedBy: info.name,
          updatedAt: serverTimestamp(),
        });
        if (openId === id) {
          mState.className = "save-state saved";
          mState.lastChild.textContent = "shranjeno";
        }
      } catch {
        if (openId === id) {
          mState.className = "save-state";
          mState.lastChild.textContent = "napaka";
        }
      }
    }, 600);
  };
  mTitle.addEventListener("input", saveOpen);
  mText.addEventListener("input", saveOpen);

  /* ---- Nova beležka ---- */
  document.getElementById("addNoteBtn").addEventListener("click", async () => {
    try {
      const ref = await addDoc(collection(db, "notes"), {
        title: "Nova beležka",
        text: "",
        updatedBy: info.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast("Beležka dodana.");
      setTimeout(() => openModal(ref.id), 350); // odpri jo takoj
    } catch { toast("Napaka pri dodajanju.", "err"); }
  });

  /* ---- Real-time seznam ---- */
  onSnapshot(collection(db, "notes"), (snap) => {
    notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    notes.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

    // če je odprta beležka izbrisana drugje, zapri okno
    if (openId && !notes.some(n => n.id === openId)) closeModal();

    // če drug uporabnik ureja isto beležko, osveži polja (ne med tipkanjem)
    if (openId) {
      const n = notes.find(x => x.id === openId);
      if (n) {
        if (document.activeElement !== mTitle) mTitle.value = n.title || "";
        if (document.activeElement !== mText)  mText.value  = n.text  || "";
      }
    }
    renderGrid();
  }, () => {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Napaka pri nalaganju beležk.</div>`;
  });

  /* ---- Kartice = samo predogled ---- */
  function renderGrid() {
    if (!notes.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">📝</div>Ni beležk. Ustvari prvo z gumbom zgoraj.</div>`;
      return;
    }
    grid.innerHTML = notes.map(n => `
      <article class="note note-card" data-open="${n.id}" tabindex="0" role="button">
        <h3 class="note-card-title">${escapeHtml(n.title) || "Brez naslova"}</h3>
        <p class="note-card-text">${escapeHtml(n.text) || "Prazna beležka — klikni za urejanje."}</p>
        <div class="note-foot">
          <span>${formatTs(n.updatedAt)} · ${escapeHtml(n.updatedBy || "")}</span>
          <span class="note-card-open">Odpri →</span>
        </div>
      </article>`).join("");

    grid.querySelectorAll("[data-open]").forEach(card => {
      const go = () => openModal(card.dataset.open);
      card.addEventListener("click", go);
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
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

