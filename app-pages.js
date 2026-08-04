// app-pages.js
// -----------------------------------------------------------------------------
// Moduli strani: Cold Calli (tabela podjetij) in Anketa (survey).
// Ločeno od app.js, da so datoteke manjše in se zanesljivo prenesejo.
// -----------------------------------------------------------------------------

import {
  db,
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, increment,
} from "./firebase.js";
import {
  toast, escapeHtml, statusBadge, formatTs, bindModal,
} from "./app-core.js";

/* =========================================================================
   STRAN: COLD CALLI (tabela podjetij)
   ========================================================================= */
export function initColdCalls() {
  const tbody = document.getElementById("companyRows");
  const searchEl = document.getElementById("companySearch");
  const filterEl = document.getElementById("companyStatusFilter");
  const modal = bindModal("companyModal");
  let companies = [];
  let editingId = null;

  onSnapshot(collection(db, "companies"), (snap) => {
    companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    companies.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sl"));
    render();
  }, () => {
    tbody.innerHTML = `<tr><td colspan="10" class="sub">Napaka pri nalaganju. Preveri Firebase nastavitve.</td></tr>`;
  });

  function render() {
    const q = (searchEl.value || "").toLowerCase().trim();
    const fs = filterEl.value;
    const list = companies.filter(c => {
      const hay = `${c.name} ${c.person} ${c.activity} ${c.contact} ${c.city} ${c.website} ${c.google}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      const okS = !fs || (c.status || "Ni klicano") === fs;
      return okQ && okS;
    });

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="10"><div class="empty"><div class="big">📞</div>Ni podjetij. Dodaj prvo z gumbom zgoraj.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td>${escapeHtml(c.person) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.activity) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.contact) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.city) || "<span class='sub'>—</span>"}</td>
        <td>${c.website
          ? `<a href="${encodeURI(c.website)}" target="_blank" rel="noopener" class="badge s-zainteresiran" style="text-decoration:none">Da ↗</a>`
          : `<span class="badge s-ni-zainteresiran">Ne</span>`}</td>
        <td>${escapeHtml(c.google) || "<span class='sub'>—</span>"}</td>
        <td><span class="count-pill">${c.responseCount || 0}</span></td>
        <td>${statusBadge(c.status)}</td>
        <td style="text-align:right; white-space:nowrap">
          <a class="btn sm primary" href="survey.html?company=${encodeURIComponent(c.id)}">Odpri anketo</a>
          <button class="btn sm" data-edit-company="${c.id}" title="Uredi podjetje">✏</button>
          <button class="btn sm danger" data-del-company="${c.id}" data-name="${escapeHtml(c.name)}" title="Izbriši podjetje">🗑</button>
        </td>
      </tr>`).join("");

    // Poveži gumbe za brisanje (po vsakem izrisu tabele)
    tbody.querySelectorAll("[data-del-company]").forEach(b =>
      b.addEventListener("click", () => removeCompany(b.dataset.delCompany, b.dataset.name)));
    // Poveži gumbe za urejanje
    tbody.querySelectorAll("[data-edit-company]").forEach(b =>
      b.addEventListener("click", () => openEditCompany(b.dataset.editCompany)));
  }

  // Polja okna
  const F = { name: "cName", person: "cPerson", activity: "cActivity", contact: "cContact",
              city: "cCity", website: "cWebsite", google: "cGoogle" };
  const clearForm = () => Object.values(F).forEach(id => document.getElementById(id).value = "");
  const fillForm = (c) => Object.entries(F).forEach(([k, id]) => document.getElementById(id).value = c[k] || "");

  // Odpri okno za UREJANJE obstoječega podjetja
  function openEditCompany(id) {
    const c = companies.find(x => x.id === id);
    if (!c) return;
    editingId = id;
    fillForm(c);
    document.getElementById("companyModalTitle").textContent = "Uredi podjetje";
    document.getElementById("saveCompanyBtn").textContent = "Shrani spremembe";
    dupWarn.style.display = "none";
    modal.open();
  }

  // Izbriše podjetje in vse njegove odgovore
  async function removeCompany(id, name) {
    const ok = confirm(
      `Res izbrišem podjetje "${name}"?\n\n` +
      `Izbrisani bodo tudi vsi njegovi odgovori.\nTega ni mogoče razveljaviti.`
    );
    if (!ok) return;
    try {
      // najprej odgovori tega podjetja
      const snap = await getDocs(query(collection(db, "responses"), where("companyId", "==", id)));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "responses", d.id))));
      // nato podjetje
      await deleteDoc(doc(db, "companies", id));
      toast(`Podjetje "${name}" izbrisano.`);
    } catch {
      toast("Napaka pri brisanju.", "err");
    }
  }

  searchEl.addEventListener("input", render);
  filterEl.addEventListener("change", render);

  document.getElementById("addCompanyBtn").addEventListener("click", () => {
    editingId = null;
    clearForm();
    document.getElementById("companyModalTitle").textContent = "Dodaj podjetje";
    document.getElementById("saveCompanyBtn").textContent = "Shrani";
    dupWarn.style.display = "none";
    modal.open();
  });

  /* ---- Živo opozorilo med tipkanjem (preden klikneš Shrani) ---- */
  const dupWarn = document.createElement("div");
  dupWarn.className = "dup-warn";
  dupWarn.style.display = "none";
  document.getElementById("saveCompanyBtn").closest(".modal")
    .insertBefore(dupWarn, document.querySelector("#companyModal .modal-foot"));

  const checkLive = () => {
    if (editingId) { dupWarn.style.display = "none"; return; }
    const name = document.getElementById("cName").value.trim();
    const contact = document.getElementById("cContact").value.trim();
    if (!name && !contact) { dupWarn.style.display = "none"; return; }
    const dupes = findDuplicates(name, contact);
    if (!dupes.length) { dupWarn.style.display = "none"; return; }
    dupWarn.style.display = "block";
    dupWarn.innerHTML = `⚠️ <b>Že v seznamu:</b> ` +
      dupes.slice(0, 3).map(d => escapeHtml(d.name) + (d.city ? ` (${escapeHtml(d.city)})` : "")).join(", ");
  };
  document.getElementById("cName").addEventListener("input", checkLive);
  document.getElementById("cContact").addEventListener("input", checkLive);

  /* ---- Preverjanje podvojenih vnosov ---- */
  // Poenostavi ime za primerjavo: male črke, brez šumnikov, brez pravnih oblik in ločil.
  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // č→c, š→s, ž→z
      .replace(/\b(d\.?o\.?o\.?|s\.?p\.?|d\.?d\.?|k\.?d\.?)\b/g, "") // d.o.o., s.p. …
      .replace(/[^a-z0-9]/g, "")                            // ločila in presledki
      .trim();
  }
  // Primerja samo števke telefona (da +386 40 123 456 = 040123456)
  function normPhone(s) {
    const d = String(s || "").replace(/\D/g, "");
    return d.length >= 6 ? d.slice(-8) : "";   // zadnjih 8 števk
  }

  // Vrne seznam obstoječih podjetij, ki so videti kot isto podjetje.
  function findDuplicates(name, contact) {
    const n = normName(name);
    const p = normPhone(contact);
    return companies.filter(c => {
      const cn = normName(c.name);
      if (n && cn && (cn === n || cn.includes(n) || n.includes(cn))) return true;
      if (p && normPhone(c.contact) === p) return true;
      return false;
    });
  }

  document.getElementById("saveCompanyBtn").addEventListener("click", async () => {
    const name = document.getElementById("cName").value.trim();
    const contact = document.getElementById("cContact").value.trim();
    if (!name) { toast("Vnesi ime podjetja.", "err"); return; }

    // Skupni podatki iz obrazca
    const data = {
      name,
      person: document.getElementById("cPerson").value.trim(),
      activity: document.getElementById("cActivity").value.trim(),
      contact,
      city: document.getElementById("cCity").value.trim(),
      website: document.getElementById("cWebsite").value.trim(),
      google: document.getElementById("cGoogle").value.trim(),
    };

    // --- UREJANJE obstoječega podjetja ---
    if (editingId) {
      try {
        await updateDoc(doc(db, "companies", editingId), data);
        editingId = null;
        clearForm();
        modal.close();
        toast("Spremembe shranjene.");
      } catch (e) {
        toast("Napaka pri shranjevanju.", "err");
      }
      return;
    }

    // --- DODAJANJE novega: opozorilo, če je videti kot podvojeno ---
    const dupes = findDuplicates(name, contact);
    if (dupes.length) {
      const list = dupes.slice(0, 3).map(d =>
        `• ${d.name}${d.city ? " (" + d.city + ")" : ""}${d.contact ? " — " + d.contact : ""}`
      ).join("\n");
      const ok = confirm(
        `⚠️ To podjetje je verjetno že v seznamu:\n\n${list}\n\n` +
        `Vseeno dodam kot novo podjetje?`
      );
      if (!ok) return;
    }

    try {
      await addDoc(collection(db, "companies"), {
        ...data,
        status: "Ni klicano",
        responseCount: 0,
        createdAt: serverTimestamp(),
      });
      clearForm();
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
export function initSurvey(user, info) {
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

