// ponudba.js
// -----------------------------------------------------------------------------
// Javna stran za povpraševanje po spletni strani. NE zahteva prijave.
// V ozadju se anonimno prijavi (stranka tega ne vidi), da lahko shrani obrazec
// v Firestore z obstoječimi pravili. Odgovori gredo v zbirko "ponudbe".
// -----------------------------------------------------------------------------

import {
  auth, db, signInAnonymously,
  collection, addDoc, doc, getDoc, serverTimestamp,
} from "./firebase.js";

// Anonimna prijava v ozadju (potrebna za pisanje v Firestore).
const authReady = signInAnonymously(auth).catch((e) => { console.error(e); throw e; });

// Če povezava vsebuje ?podjetje=ID, povežemo obrazec s podjetjem iz Cold Calli.
const params = new URLSearchParams(location.search);
const companyId = params.get("podjetje");

if (companyId) {
  getDoc(doc(db, "companies", companyId)).then((snap) => {
    if (snap.exists()) {
      const c = snap.data();
      const el = document.getElementById("oCompany");
      if (el && c.name) el.value = c.name;
      if (c.person) { const n = document.getElementById("oName"); if (n) n.value = c.person; }
      const t = document.getElementById("offerTitle");
      if (t && c.name) t.textContent = `Ponudba za ${c.name}`;
    }
  }).catch(() => { /* ni kritično */ });
}

// Pomožno: preberi vrednost izbranega radia
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || "";
// Pomožno: preberi vse obkljukane
const checks = (id) =>
  [...document.querySelectorAll(`#${id} input:checked`)].map((c) => c.value);

const form = document.getElementById("offerForm");
const msg = document.getElementById("offerMsg");
const btn = document.getElementById("offerSubmit");

// Zapiranje pojavnega okna z zahvalo
const thankModal = document.getElementById("thankModal");
const closeThank = () => thankModal.classList.remove("show");
document.getElementById("thankClose")?.addEventListener("click", closeThank);
thankModal?.addEventListener("click", (e) => { if (e.target === thankModal) closeThank(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const company = document.getElementById("oCompany").value.trim();
  const name = document.getElementById("oName").value.trim();
  const phone = document.getElementById("oPhone").value.trim();

  // Minimalna zahteva: vsaj kontakt (telefon ali e-pošta) in ime podjetja/osebe
  const email = document.getElementById("oEmail").value.trim();
  if (!company && !name) { msg.className = "form-msg err"; msg.textContent = "Vnesite ime podjetja ali kontaktne osebe."; return; }
  if (!phone && !email) { msg.className = "form-msg err"; msg.textContent = "Vnesite telefon ali e-pošto, da vas lahko kontaktiramo."; return; }

  btn.disabled = true;
  msg.className = "form-msg";
  msg.textContent = "Pošiljam…";

  try {
    await authReady; // počakaj na anonimno prijavo
    await addDoc(collection(db, "ponudbe"), {
      companyId: companyId || null,
      companyName: company,
      activity: document.getElementById("oActivity").value.trim(),
      contactName: name,
      phone, email,
      address: document.getElementById("oAddress").value.trim(),
      hours: document.getElementById("oHours").value.trim(),
      currentSite: document.getElementById("oCurrentSite").value.trim(),
      slogan: document.getElementById("oSlogan").value.trim(),
      about: document.getElementById("oAbout").value.trim(),
      services: document.getElementById("oServices").value.trim(),
      prices: document.getElementById("oPrices").value.trim(),
      style: radio("style"),
      colors: document.getElementById("oColors").value.trim(),
      examples: document.getElementById("oExamples").value.trim(),
      siteType: radio("type"),
      goal: radio("goal"),
      pages: checks("oPages"),
      features: checks("oFeatures"),
      hasLogo: radio("logo"),
      hasPhotos: radio("photos"),
      hasText: radio("text"),
      materials: document.getElementById("oMaterials").value.trim(),
      social: document.getElementById("oSocial").value.trim(),
      plan: radio("plan"),
      deadline: document.getElementById("oDeadline").value,
      notes: document.getElementById("oNotes").value.trim(),
      status: "Novo",
      createdAt: serverTimestamp(),
    });

    // Skrij obrazec, prikaži zahvalo + pojavno okno
    form.style.display = "none";
    document.getElementById("offerSuccess").style.display = "block";
    document.getElementById("offerSub").style.display = "none";
    document.getElementById("thankModal").classList.add("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    btn.disabled = false;
    msg.className = "form-msg err";
    msg.textContent = "Napaka pri pošiljanju. Poskusite znova ali nas pokličite.";
    console.error(err);
  }
});
