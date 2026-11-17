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
  let activeCountry = "SI";   // izbrani zavihek države

  // Zapomni si zadnji izbrani zavihek
  try { activeCountry = localStorage.getItem("calldesk-country") || "SI"; } catch { /* ignore */ }

  /* ---- Zavihki po državah ---- */
  const tabsEl = document.getElementById("countryTabs");
  if (tabsEl) {
    tabsEl.querySelectorAll(".ctab").forEach(b => {
      b.classList.toggle("on", b.dataset.country === activeCountry);
      b.addEventListener("click", () => {
        activeCountry = b.dataset.country;
        try { localStorage.setItem("calldesk-country", activeCountry); } catch { /* ignore */ }
        tabsEl.querySelectorAll(".ctab").forEach(x => x.classList.toggle("on", x === b));
        render();
      });
    });
  }

  // Podjetja brez vpisane države štejemo kot slovenska (stari vnosi)
  const countryOf = (c) => c.country || "SI";

  function updateCounts() {
    const n = { SI: 0, US: 0, all: companies.length };
    companies.forEach(c => { const k = countryOf(c); n[k] = (n[k] || 0) + 1; });
    document.querySelectorAll("[data-cnt]").forEach(el => {
      el.textContent = n[el.dataset.cnt] || 0;
    });
  }

  onSnapshot(collection(db, "companies"), (snap) => {
    companies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    companies.sort((a, b) => (a.name || "").localeCompare(b.name || "", "sl"));
    render();
  }, () => {
    tbody.innerHTML = `<tr><td colspan="12" class="sub">Napaka pri nalaganju. Preveri Firebase nastavitve.</td></tr>`;
  });

  function render() {
    updateCounts();
    const q = (searchEl.value || "").toLowerCase().trim();
    const fs = filterEl.value;
    const list = companies.filter(c => {
      const hay = `${c.name} ${c.person} ${c.activity} ${c.contact} ${c.email} ${c.city} ${c.website} ${c.reason} ${c.google}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      const okS = !fs || (c.status || "Ni klicano") === fs;
      const okC = activeCountry === "all" || countryOf(c) === activeCountry;
      return okQ && okS && okC;
    });

    if (!list.length) {
      const kje = activeCountry === "US" ? " v ZDA"
                : activeCountry === "SI" ? " v Sloveniji" : "";
      tbody.innerHTML = `<tr><td colspan="12"><div class="empty"><div class="big">📞</div>Ni podjetij${kje}. Dodaj prvo z gumbom zgoraj.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td>${escapeHtml(c.person) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.activity) || "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.contact) || "<span class='sub'>—</span>"}</td>
        <td>${c.email
          ? `<a href="mailto:${encodeURIComponent(c.email).replace(/%40/g, "@")}" class="mail-link">${escapeHtml(c.email)}</a>`
          : "<span class='sub'>—</span>"}</td>
        <td>${escapeHtml(c.city) || "<span class='sub'>—</span>"}</td>
        <td>${c.website
          ? `<a href="${encodeURI(c.website)}" target="_blank" rel="noopener" class="badge s-zainteresiran" style="text-decoration:none">Da ↗</a>`
          : `<span class="badge s-ni-zainteresiran">Ne</span>`}</td>
        <td class="cell-reason">${escapeHtml(c.reason) || "<span class='sub'>—</span>"}</td>
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
              email: "cEmail", city: "cCity", website: "cWebsite", reason: "cReason",
              google: "cGoogle" };
  const countryEl = () => document.getElementById("cCountry");
  // Ob praznem obrazcu predlagamo državo trenutnega zavihka
  const clearForm = () => {
    Object.values(F).forEach(id => document.getElementById(id).value = "");
    if (countryEl()) countryEl().value = (activeCountry === "all" ? "SI" : activeCountry);
  };
  const fillForm = (c) => {
    Object.entries(F).forEach(([k, id]) => document.getElementById(id).value = c[k] || "");
    if (countryEl()) countryEl().value = countryOf(c);
  };

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

  /* =======================================================================
     UVOZ IZ CSV
     ===================================================================== */
  const csvModal = bindModal("csvModal");
  const csvFile = document.getElementById("csvFile");

  const DRZ_IME = { SI: "Slovenija", US: "ZDA", all: "Slovenija" };

  document.getElementById("importCsvBtn")?.addEventListener("click", () => {
    document.getElementById("csvIntro").style.display = "block";
    document.getElementById("csvProgress").style.display = "none";
    document.getElementById("csvResult").style.display = "none";
    document.getElementById("csvPickBtn").style.display = "";
    document.getElementById("csvCountryName").textContent = DRZ_IME[activeCountry] || "Slovenija";
    csvModal.open();
  });

  document.getElementById("csvPickBtn")?.addEventListener("click", () => csvFile.click());

  csvFile?.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { uvoziCsv(String(r.result)); csvFile.value = ""; };
    r.onerror = () => { toast("Datoteke ni bilo mogoče prebrati.", "err"); csvFile.value = ""; };
    r.readAsText(f, "UTF-8");
  });

  // Razčleni eno vrstico CSV (podpira narekovaje in vejice znotraj njih)
  function parseVrstica(line, sep) {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === sep) { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // Poenostavi ime stolpca za primerjavo
  const kljuc = (s) => String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

  // Kateri naslovi stolpcev ustrezajo kateremu polju
  const STOLPCI = {
    name:    ["podjetje", "imepodjetja", "naziv", "company", "name", "businessname"],
    person:  ["kontaktnaoseba", "oseba", "imeinpriimek", "contact", "contactperson", "owner"],
    activity:["dejavnost", "vrstadejavnosti", "panoga", "category", "type", "industry"],
    contact: ["kontakt", "telefon", "tel", "phone", "telephone", "mobile"],
    email:   ["gmail", "email", "mail", "eposta", "epostninaslov", "emailaddress", "epota"],
    city:    ["kraj", "mesto", "city", "location", "town"],
    website: ["spletnastran", "stran", "website", "web", "url", "site"],
    reason:  ["razlog", "razlogspletnestrani", "razlogzaspletnostran", "zakaj", "opomba",
              "opombe", "reason", "note", "notes", "why"],
    google:  ["googleocene", "ocene", "ocena", "rating", "reviews", "googlerating"],
  };

  async function uvoziCsv(besedilo) {
    // odstrani BOM
    besedilo = besedilo.replace(/^﻿/, "");
    const vrstice = besedilo.split(/\r?\n/).filter(v => v.trim() !== "");
    if (vrstice.length < 2) {
      toast("Datoteka je prazna ali nima podatkov.", "err");
      return;
    }

    // ugotovi ločilo: podpičje ali vejica (kar je pogostejše v glavi)
    const glavaRaw = vrstice[0];
    const sep = (glavaRaw.split(";").length > glavaRaw.split(",").length) ? ";" : ",";
    const glava = parseVrstica(glavaRaw, sep).map(kljuc);

    // poveži stolpce s polji
    const idx = {};
    Object.entries(STOLPCI).forEach(([polje, imena]) => {
      const i = glava.findIndex(h => imena.includes(h));
      if (i !== -1) idx[polje] = i;
    });

    if (idx.name === undefined) {
      pokaziRezultat(`<p style="color:var(--danger)">V datoteki ne najdem stolpca z imenom podjetja.</p>
        <p class="hint" style="margin-top:8px">Prva vrstica naj vsebuje naslov <b>Podjetje</b> (ali Company / Name).</p>`);
      return;
    }

    const drz = activeCountry === "all" ? "SI" : activeCountry;
    const vrstic = vrstice.length - 1;

    // pripravi vnose
    const kandidati = [];
    for (let i = 1; i < vrstice.length; i++) {
      const p = parseVrstica(vrstice[i], sep);
      const v = (k) => (idx[k] !== undefined ? (p[idx[k]] || "").trim() : "");
      const ime = v("name");
      if (!ime) continue;
      kandidati.push({
        name: ime,
        person: v("person"),
        activity: v("activity"),
        contact: v("contact"),
        email: v("email"),
        city: v("city"),
        website: v("website"),
        reason: v("reason"),
        google: v("google"),
        country: drz,
      });
    }

    if (!kandidati.length) {
      pokaziRezultat(`<p style="color:var(--danger)">V datoteki ni nobene vrstice z imenom podjetja.</p>`);
      return;
    }

    // prikaz napredka
    document.getElementById("csvIntro").style.display = "none";
    document.getElementById("csvPickBtn").style.display = "none";
    document.getElementById("csvProgress").style.display = "block";
    document.getElementById("csvTotal").textContent = kandidati.length;

    // že obstoječa podjetja v tej državi (za preskok dvojnikov)
    const obstojeca = new Set(
      companies.filter(c => countryOf(c) === drz).map(c => normName(c.name))
    );
    const vDatoteki = new Set();

    let dodanih = 0, preskocenih = 0, napak = 0;

    for (let i = 0; i < kandidati.length; i++) {
      const k = kandidati[i];
      const n = normName(k.name);
      if (obstojeca.has(n) || vDatoteki.has(n)) { preskocenih++; }
      else {
        try {
          await addDoc(collection(db, "companies"), {
            ...k, status: "Ni klicano", responseCount: 0, createdAt: serverTimestamp(),
          });
          vDatoteki.add(n);
          dodanih++;
        } catch { napak++; }
      }
      const done = i + 1;
      document.getElementById("csvDone").textContent = done;
      document.getElementById("csvBarFill").style.width =
        Math.round(done / kandidati.length * 100) + "%";
    }

    pokaziRezultat(`
      <p style="margin-bottom:12px"><b>Uvoz končan.</b></p>
      <div class="csv-stat"><span>Dodanih podjetij</span><b style="color:var(--accent)">${dodanih}</b></div>
      <div class="csv-stat"><span>Preskočenih (že obstajajo)</span><b>${preskocenih}</b></div>
      ${napak ? `<div class="csv-stat"><span>Napak pri shranjevanju</span><b style="color:var(--danger)">${napak}</b></div>` : ""}
      <div class="csv-stat"><span>Prebranih vrstic</span><b>${vrstic}</b></div>
      <p class="hint" style="margin-top:12px">Uvoženo v: <b>${DRZ_IME[drz]}</b></p>
    `);
    if (dodanih) toast(`Uvoženih ${dodanih} podjetij.`);
  }

  function pokaziRezultat(html) {
    document.getElementById("csvIntro").style.display = "none";
    document.getElementById("csvProgress").style.display = "none";
    document.getElementById("csvPickBtn").style.display = "none";
    const r = document.getElementById("csvResult");
    r.style.display = "block";
    r.innerHTML = html;
  }

  /* =======================================================================
     BRISANJE VSEH PODJETIJ (v trenutno izbranem zavihku)
     ===================================================================== */
  const wipeModal = bindModal("wipeModal");
  const wipeInput = document.getElementById("wipeConfirm");
  const wipeGo = document.getElementById("wipeGoBtn");

  // Katera podjetja bo brisanje zajelo
  function wipeSeznam() {
    return activeCountry === "all"
      ? companies.slice()
      : companies.filter(c => countryOf(c) === activeCountry);
  }

  // Potrditvena beseda — sprejmemo z ali brez šumnika, velike ali male črke
  const potrjeno = () => {
    const v = (wipeInput?.value || "").trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
    return v === "zbrisi";
  };

  wipeInput?.addEventListener("input", () => { if (wipeGo) wipeGo.disabled = !potrjeno(); });

  document.getElementById("wipeBtn")?.addEventListener("click", () => {
    const t = wipeSeznam();
    if (!t.length) { toast("V tem zavihku ni podjetij.", "err"); return; }
    document.getElementById("wipeIntro").style.display = "block";
    document.getElementById("wipeProgress").style.display = "none";
    document.getElementById("wipeResult").style.display = "none";
    document.getElementById("wipeFoot").style.display = "";
    document.getElementById("wipeFootEnd").style.display = "none";
    document.getElementById("wipeCount").textContent = t.length;
    document.getElementById("wipeWhere").textContent =
      activeCountry === "all" ? "vse države" : (DRZ_IME[activeCountry] || "Slovenija");
    if (wipeInput) wipeInput.value = "";
    if (wipeGo) wipeGo.disabled = true;
    wipeModal.open();
    setTimeout(() => wipeInput?.focus(), 60);
  });

  wipeGo?.addEventListener("click", async () => {
    if (!potrjeno()) return;
    const t = wipeSeznam();
    if (!t.length) { toast("V tem zavihku ni podjetij.", "err"); return; }
    const ids = new Set(t.map(c => c.id));
    const kje = activeCountry === "all" ? "vse države" : (DRZ_IME[activeCountry] || "Slovenija");

    // preklop na prikaz napredka
    document.getElementById("wipeIntro").style.display = "none";
    document.getElementById("wipeFoot").style.display = "none";
    document.getElementById("wipeProgress").style.display = "block";

    // poišči odgovore, ki pripadajo tem podjetjem
    let odgovori = [];
    try {
      const rs = await getDocs(collection(db, "responses"));
      odgovori = rs.docs
        .filter(d => ids.has((d.data() || {}).companyId))
        .map(d => d.id);
    } catch { /* če ne gre, pobrišemo vsaj podjetja */ }

    const skupaj = t.length + odgovori.length;
    document.getElementById("wipeTotal").textContent = skupaj;
    let narejeno = 0;
    const korak = () => {
      narejeno++;
      document.getElementById("wipeDone").textContent = narejeno;
      document.getElementById("wipeBarFill").style.width =
        Math.round(narejeno / skupaj * 100) + "%";
    };

    // brisanje po svežnjih (10 naenkrat, da ne preobremenimo povezave)
    async function brisiSeznam(pot, seznam) {
      let ok = 0, err = 0;
      for (let i = 0; i < seznam.length; i += 10) {
        await Promise.all(seznam.slice(i, i + 10).map(async (id) => {
          try { await deleteDoc(doc(db, pot, id)); ok++; } catch { err++; }
          korak();
        }));
      }
      return { ok, err };
    }

    const ro = await brisiSeznam("responses", odgovori);
    const po = await brisiSeznam("companies", t.map(c => c.id));
    const napak = ro.err + po.err;

    document.getElementById("wipeProgress").style.display = "none";
    const r = document.getElementById("wipeResult");
    r.style.display = "block";
    r.innerHTML = `
      <p style="margin-bottom:12px"><b>Brisanje končano.</b></p>
      <div class="csv-stat"><span>Izbrisanih podjetij</span><b>${po.ok}</b></div>
      <div class="csv-stat"><span>Izbrisanih odgovorov</span><b>${ro.ok}</b></div>
      ${napak ? `<div class="csv-stat"><span>Napak pri brisanju</span><b style="color:var(--danger)">${napak}</b></div>` : ""}
      <p class="hint" style="margin-top:12px">Zavihek: <b>${escapeHtml(kje)}</b></p>`;
    document.getElementById("wipeFootEnd").style.display = "";

    if (napak) toast(`Izbrisano, a ${napak} vnosov ni bilo mogoče izbrisati.`, "err");
    else toast(`Izbrisanih ${po.ok} podjetij.`);
  });

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
    // Dvojnike iščemo samo znotraj izbrane države
    const drz = countryEl() ? countryEl().value : "SI";
    return companies.filter(c => {
      if (countryOf(c) !== drz) return false;
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
      email: document.getElementById("cEmail").value.trim(),
      city: document.getElementById("cCity").value.trim(),
      website: document.getElementById("cWebsite").value.trim(),
      reason: document.getElementById("cReason").value.trim(),
      google: document.getElementById("cGoogle").value.trim(),
      country: countryEl() ? countryEl().value : "SI",
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

