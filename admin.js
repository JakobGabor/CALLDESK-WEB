// admin.js
// -----------------------------------------------------------------------------
// Admin nadzorna plošča: statistika, vsi odgovori, uporabniki, iskanje, filtri,
// izvoz v CSV, urejanje in brisanje odgovorov.
// Uporablja skupno zaščito (guard) in pomožne funkcije iz app.js.
// -----------------------------------------------------------------------------

import {
  db, collection, doc, onSnapshot, updateDoc, deleteDoc,
} from "./firebase.js";
import {
  guard, toast, escapeHtml, statusBadge, formatTs,
} from "./app.js";

guard("admin", (user, info) => {
  const notAdmin = document.getElementById("notAdmin");
  const body = document.getElementById("adminBody");

  if (!info.isAdmin) {
    notAdmin.style.display = "block";
    body.style.display = "none";
    document.getElementById("exportCsvBtn").style.display = "none";
    return;
  }
  body.style.display = "block";

  const editModal = document.getElementById("editModal");
  const respRows = document.getElementById("respRows");
  const userRows = document.getElementById("userRows");
  const searchEl = document.getElementById("respSearch");
  const statusFilter = document.getElementById("respStatusFilter");
  const interestFilter = document.getElementById("respInterestFilter");

  let responses = [];
  let users = {}; // uid -> {name, email}

  /* ---- Uporabniki (real-time) ---- */
  onSnapshot(collection(db, "users"), (snap) => {
    users = {};
    snap.forEach(d => { users[d.id] = d.data(); });
    document.getElementById("aUsers").textContent = snap.size;
    renderUsers();
  });

  /* ---- Vsi odgovori (real-time) ---- */
  onSnapshot(collection(db, "responses"), (snap) => {
    responses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    responses.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    updateStats();
    renderUsers();
    renderResponses();
  }, () => {
    respRows.innerHTML = `<tr><td colspan="9" class="sub">Napaka pri nalaganju odgovorov.</td></tr>`;
  });

  /* ---- Statistika ---- */
  function updateStats() {
    let answered = 0, interested = 0;
    responses.forEach(r => {
      if (r.answered === "Da") answered++;
      if (r.interested === "Da" || r.status === "Zainteresiran") interested++;
    });
    document.getElementById("aCalls").textContent = responses.length;
    document.getElementById("aAnswered").textContent = answered;
    document.getElementById("aInterested").textContent = interested;
  }

  /* ---- Klici po uporabnikih ---- */
  function renderUsers() {
    const counts = {};
    responses.forEach(r => { counts[r.userId] = (counts[r.userId] || 0) + 1; });
    const ids = new Set([...Object.keys(users), ...Object.keys(counts)]);
    if (!ids.size) { userRows.innerHTML = `<tr><td colspan="3" class="sub">Ni podatkov.</td></tr>`; return; }
    const rows = [...ids].map(uid => {
      const u = users[uid] || {};
      const name = u.name || (uid ? uid.slice(0, 6) : "neznano");
      const email = u.email || (u.anonymous ? "gost" : "—");
      return { name, email, n: counts[uid] || 0 };
    }).sort((a, b) => b.n - a.n);
    userRows.innerHTML = rows.map(r => `
      <tr>
        <td><b>${escapeHtml(r.name)}</b></td>
        <td class="sub">${escapeHtml(r.email)}</td>
        <td><span class="count-pill">${r.n}</span></td>
      </tr>`).join("");
  }

  /* ---- Tabela odgovorov (z iskanjem in filtri) ---- */
  function renderResponses() {
    const q = (searchEl.value || "").toLowerCase().trim();
    const fs = statusFilter.value;
    const fi = interestFilter.value;
    const list = responses.filter(r => {
      const hay = `${r.companyName} ${r.name} ${r.phone} ${r.comment} ${r.userName}`.toLowerCase();
      return (!q || hay.includes(q)) &&
             (!fs || r.status === fs) &&
             (!fi || r.interested === fi);
    });

    if (!list.length) {
      respRows.innerHTML = `<tr><td colspan="9"><div class="empty"><div class="big">📭</div>Ni odgovorov za ta filter.</div></td></tr>`;
      return;
    }
    respRows.innerHTML = list.map(r => `
      <tr>
        <td class="sub" style="white-space:nowrap">${formatTs(r.createdAt)}</td>
        <td><b>${escapeHtml(r.companyName) || "—"}</b></td>
        <td>${escapeHtml(r.name) || "<span class='sub'>—</span>"}<div class="sub">${escapeHtml(r.phone) || ""}</div></td>
        <td>${escapeHtml(r.answered) || "—"}</td>
        <td>${escapeHtml(r.interested) || "—"}</td>
        <td style="max-width:220px"><span class="sub">${escapeHtml(r.comment) || "—"}</span></td>
        <td>${statusBadge(r.status)}</td>
        <td class="sub">${escapeHtml(r.userName) || "—"}</td>
        <td style="white-space:nowrap; text-align:right">
          <button class="btn sm" data-edit="${r.id}">✏</button>
          <button class="btn sm danger" data-del="${r.id}">🗑</button>
        </td>
      </tr>`).join("");

    respRows.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => openEdit(b.dataset.edit)));
    respRows.querySelectorAll("[data-del]").forEach(b =>
      b.addEventListener("click", () => removeResponse(b.dataset.del)));
  }

  searchEl.addEventListener("input", renderResponses);
  statusFilter.addEventListener("change", renderResponses);
  interestFilter.addEventListener("change", renderResponses);

  /* ---- Uredi odgovor ---- */
  function openEdit(id) {
    const r = responses.find(x => x.id === id);
    if (!r) return;
    document.getElementById("eId").value = id;
    document.getElementById("eName").value = r.name || "";
    document.getElementById("ePhone").value = r.phone || "";
    document.getElementById("eAnswered").value = r.answered || "";
    document.getElementById("eInterested").value = r.interested || "";
    document.getElementById("eComment").value = r.comment || "";
    document.getElementById("eStatus").value = r.status || "Poklicano";
    editModal.classList.add("show");
  }
  const closeEdit = () => editModal.classList.remove("show");
  editModal.addEventListener("click", e => { if (e.target === editModal) closeEdit(); });
  editModal.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", closeEdit));

  document.getElementById("saveEditBtn").addEventListener("click", async () => {
    const id = document.getElementById("eId").value;
    try {
      await updateDoc(doc(db, "responses", id), {
        name: document.getElementById("eName").value.trim(),
        phone: document.getElementById("ePhone").value.trim(),
        answered: document.getElementById("eAnswered").value,
        interested: document.getElementById("eInterested").value,
        comment: document.getElementById("eComment").value.trim(),
        status: document.getElementById("eStatus").value,
      });
      closeEdit();
      toast("Odgovor posodobljen.");
    } catch { toast("Napaka pri shranjevanju.", "err"); }
  });

  /* ---- Izbriši odgovor ---- */
  async function removeResponse(id) {
    if (!confirm("Res izbrišem ta odgovor?")) return;
    try { await deleteDoc(doc(db, "responses", id)); toast("Odgovor izbrisan."); }
    catch { toast("Napaka pri brisanju.", "err"); }
  }

  /* ---- Povpraševanja za spletno stran (zbirka "ponudbe") ---- */
  const leadRows = document.getElementById("leadRows");
  const leadModal = document.getElementById("leadModal");
  const leadDetails = document.getElementById("leadDetails");
  let leads = [];
  let openLeadId = null;

  onSnapshot(collection(db, "ponudbe"), (snap) => {
    leads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    leads.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    document.getElementById("leadCount").textContent = leads.length;
    renderLeads();
  }, () => {
    leadRows.innerHTML = `<tr><td colspan="7" class="sub">Napaka pri nalaganju.</td></tr>`;
  });

  function renderLeads() {
    if (!leads.length) {
      leadRows.innerHTML = `<tr><td colspan="7" class="sub">Še ni povpraševanj. Pošljite stranki povezavo do ponudba.html.</td></tr>`;
      return;
    }
    leadRows.innerHTML = leads.map(l => `
      <tr>
        <td class="sub" style="white-space:nowrap">${formatTs(l.createdAt)}</td>
        <td><b>${escapeHtml(l.companyName) || "—"}</b></td>
        <td>${escapeHtml(l.contactName) || "—"}<div class="sub">${escapeHtml(l.phone || l.email || "")}</div></td>
        <td>${escapeHtml(l.siteType) || "—"}</td>
        <td>${escapeHtml(l.plan) || "<span class='sub'>—</span>"}</td>
        <td class="sub">${escapeHtml(l.deadline) || "—"}</td>
        <td style="text-align:right"><button class="btn sm primary" data-lead="${l.id}">Podrobnosti</button></td>
      </tr>`).join("");
    leadRows.querySelectorAll("[data-lead]").forEach(b =>
      b.addEventListener("click", () => openLead(b.dataset.lead)));
  }

  function row(label, value) {
    if (!value || (Array.isArray(value) && !value.length)) return "";
    const v = Array.isArray(value) ? value.join(", ") : value;
    return `<div style="margin-bottom:10px"><div class="sub" style="margin-bottom:2px">${label}</div><div style="white-space:pre-wrap">${escapeHtml(v)}</div></div>`;
  }

  function openLead(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    openLeadId = id;
    leadDetails.innerHTML =
      row("Podjetje", l.companyName) +
      row("Dejavnost", l.activity) +
      row("Kontaktna oseba", l.contactName) +
      row("Telefon", l.phone) +
      row("E-pošta", l.email) +
      row("Naslov / kraj", l.address) +
      row("Delovni čas", l.hours) +
      row("Trenutna stran", l.currentSite) +
      row("Slogan", l.slogan) +
      row("O nas", l.about) +
      row("Storitve / izdelki", l.services) +
      row("Cene", l.prices) +
      row("Slog", l.style) +
      row("Želene barve", l.colors) +
      row("Zgledi", l.examples) +
      row("Vrsta strani", l.siteType) +
      row("Glavni cilj", l.goal) +
      row("Podstrani", l.pages) +
      row("Funkcije", l.features) +
      row("Ima logotip", l.hasLogo) +
      row("Ima fotografije", l.hasPhotos) +
      row("Ima besedila", l.hasText) +
      row("Materiali / povezava", l.materials) +
      row("Družbena omrežja", l.social) +
      row("Izbran paket", l.plan) +
      row("Rok", l.deadline) +
      row("Opombe", l.notes) +
      row("Prispelo", formatTs(l.createdAt));
    leadModal.classList.add("show");
  }
  const closeLead = () => { leadModal.classList.remove("show"); openLeadId = null; };
  leadModal.addEventListener("click", e => { if (e.target === leadModal) closeLead(); });
  leadModal.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", closeLead));
  document.getElementById("leadDelBtn").addEventListener("click", async () => {
    if (!openLeadId) return;
    if (!confirm("Izbrišem to povpraševanje?")) return;
    const id = openLeadId;
    closeLead();
    try { await deleteDoc(doc(db, "ponudbe", id)); toast("Povpraševanje izbrisano."); }
    catch { toast("Napaka pri brisanju.", "err"); }
  });

  /* ---- Izvoz v CSV ---- */
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const headers = ["Datum", "Podjetje", "Ime", "Telefon", "Javil", "Zanima", "Komentar", "Status", "Uporabnik"];
    const esc = (v) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = responses.map(r => [
      formatTs(r.createdAt), r.companyName, r.name, r.phone,
      r.answered, r.interested, r.comment, r.status, r.userName,
    ].map(esc).join(";"));

    const csv = "\uFEFF" + [headers.join(";"), ...rows].join("\n"); // BOM za pravilne šumnike v Excelu
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spletar-odgovori-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV izvožen.");
  });
});
