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
    a.download = `calldesk-odgovori-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV izvožen.");
  });
});
