(() => {
  const COUNCIL_LABEL = {
    honolulu: "Honolulu",
    maui: "Maui",
    hawaii: "Hawaii County",
    kauai: "Kauai",
  };
  const SUBJECT_LABEL = {
    tax: "Tax",
    transportation: "Transportation",
    food_security: "Food Security",
    affordable_housing: "Affordable Housing",
  };

  // Acronyms that show up in Hawaii county bill text. Full set powers the
  // glossary panel; a conservative subset is auto-linked inline (see INLINE).
  const GLOSSARY = {
    TAT: "Transient Accommodations Tax (hotel/short-term rental tax)",
    GET: "General Excise Tax (Hawaii's broad tax on business gross income)",
    ADU: "Accessory Dwelling Unit (a secondary home on a residential lot)",
    ohana: "Ohana unit — a secondary dwelling for extended family",
    TOD: "Transit-Oriented Development (denser housing near transit stops)",
    LIHTC: "Low-Income Housing Tax Credit",
    HUD: "U.S. Department of Housing and Urban Development",
    RPT: "Real Property Tax",
    TMK: "Tax Map Key (parcel identifier)",
    CZO: "Comprehensive Zoning Ordinance",
    ROH: "Revised Ordinances of Honolulu",
    HRS: "Hawaii Revised Statutes (state law)",
    CIP: "Capital Improvement Program (public construction budget)",
    DPP: "Department of Planning and Permitting (Honolulu)",
    SNAP: "Supplemental Nutrition Assistance Program (food benefits)",
    WIC: "Special Supplemental Nutrition Program for Women, Infants, and Children",
    EBT: "Electronic Benefits Transfer (how SNAP/WIC benefits are paid)",
    SMA: "Special Management Area (coastal land-use zone)",
    "HD#": "House Draft — a revised version of a state bill in the House",
    "SD#": "Senate Draft — a revised version of a state bill in the Senate",
    "CD#": "Conference Draft — a version reconciled between House and Senate",
  };

  // Distinctive acronyms safe to auto-link inline without matching plain
  // English words (even inside ALL-CAPS titles). GET is intentionally omitted
  // here — it collides with the English word — but is in the glossary panel.
  const INLINE = [
    "TAT", "ADU", "TOD", "LIHTC", "HUD", "RPT", "TMK",
    "CZO", "ROH", "HRS", "CIP", "DPP", "SNAP", "WIC", "EBT", "SMA",
  ];
  const INLINE_RE = new RegExp("\\b(" + INLINE.join("|") + ")\\b", "g");
  const DRAFT_RE = /\b([HSC]D)(\d+)\b/g; // HD2, SD2, CD1 …
  const DRAFT_TITLE = {
    HD: "House Draft — a revised version of a state bill in the House",
    SD: "Senate Draft — a revised version of a state bill in the Senate",
    CD: "Conference Draft — reconciled between House and Senate",
  };

  const state = {
    bills: [],
    councils: new Set(),
    subjects: new Set(),
    type: "",
    status: "",
    search: "",
    onlyClassified: true,
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Escape, then wrap recognized acronyms in <abbr> tooltips. Single pass per
  // pattern over already-escaped text, so no nesting or double-substitution.
  function annotate(raw) {
    let s = escapeHtml(raw);
    s = s.replace(INLINE_RE, (m) => `<abbr class="gloss" title="${GLOSSARY[m]}">${m}</abbr>`);
    s = s.replace(DRAFT_RE, (full, kind) =>
      `<abbr class="gloss" title="${DRAFT_TITLE[kind]}">${full}</abbr>`
    );
    return s;
  }

  function relTime(ts) {
    if (!ts) return "";
    const secs = (Date.now() - new Date(ts).getTime()) / 1000;
    if (secs < 90) return "just now";
    if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)} hr ago`;
    return `${Math.round(secs / 86400)} days ago`;
  }

  function setMeta(payload) {
    const ts = payload.last_scrape?.completed_at || payload.generated_at;
    const when = ts ? new Date(ts).toLocaleString() : "—";
    document.getElementById("meta").textContent =
      `${payload.bills.length} bills tracked · data current as of ${when} (${relTime(ts)}) · auto-refreshes every 15 min`;
  }

  function buildGlossaryPanel() {
    const dl = document.getElementById("glossary-list");
    dl.innerHTML = "";
    for (const [term, def] of Object.entries(GLOSSARY)) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = def;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
  }

  function renderChips(containerId, items, selectedSet) {
    const c = document.getElementById(containerId);
    c.innerHTML = "";
    for (const it of items) {
      const el = document.createElement("span");
      el.className = "chip" + (selectedSet.has(it.value) ? " active" : "");
      el.textContent = it.label;
      el.dataset.value = it.value;
      el.addEventListener("click", () => {
        if (selectedSet.has(it.value)) selectedSet.delete(it.value);
        else selectedSet.add(it.value);
        el.classList.toggle("active");
        applyFilters();
      });
      c.appendChild(el);
    }
  }

  function uniqueSorted(arr) {
    return [...new Set(arr.filter(Boolean))].sort();
  }

  // Populate a <select> with values, preserving the current selection.
  function populateSelect(id, values) {
    const sel = document.getElementById(id);
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>';
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    if (values.includes(current)) sel.value = current;
  }

  let filtersWired = false;

  function buildFilters(payload) {
    renderChips(
      "f-council",
      payload.councils.map((c) => ({ value: c, label: COUNCIL_LABEL[c] || c })),
      state.councils
    );
    renderChips(
      "f-subject",
      payload.subjects.map((s) => ({ value: s, label: SUBJECT_LABEL[s] || s })),
      state.subjects
    );
    populateSelect("f-type", uniqueSorted(payload.bills.map((b) => b.bill_type)));
    populateSelect("f-status", uniqueSorted(payload.bills.map((b) => b.status)));

    if (filtersWired) return;
    filtersWired = true;
    document.getElementById("f-type").addEventListener("change", (e) => {
      state.type = e.target.value;
      applyFilters();
    });
    document.getElementById("f-status").addEventListener("change", (e) => {
      state.status = e.target.value;
      applyFilters();
    });
    document.getElementById("f-search").addEventListener("input", (e) => {
      state.search = e.target.value.toLowerCase().trim();
      applyFilters();
    });
    document.getElementById("f-classified").addEventListener("change", (e) => {
      state.onlyClassified = e.target.checked;
      applyFilters();
    });
  }

  function filterBills() {
    return state.bills.filter((b) => {
      if (state.councils.size && !state.councils.has(b.council)) return false;
      if (state.subjects.size) {
        if (!b.subjects?.some((s) => state.subjects.has(s))) return false;
      } else if (state.onlyClassified && (!b.subjects || b.subjects.length === 0)) {
        return false;
      }
      if (state.type && b.bill_type !== state.type) return false;
      if (state.status && b.status !== state.status) return false;
      if (state.search) {
        const hay = [b.bill_number, b.title, b.introducer, b.raw_subject]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });
  }

  function renderRow(b) {
    const tr = document.createElement("tr");
    const council = COUNCIL_LABEL[b.council] || b.council;
    const subjPills = (b.subjects || [])
      .map(
        (s) =>
          `<span class="subject-pill ${s}" title="${SUBJECT_LABEL[s] || s}">${
            SUBJECT_LABEL[s] || s
          }</span>`
      )
      .join("");
    tr.innerHTML = `
      <td class="col-council">${escapeHtml(council)}</td>
      <td class="col-num"><a class="bill-link" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.bill_number)}</a></td>
      <td class="col-type">${escapeHtml(b.bill_type)}</td>
      <td class="col-title">
        <div class="bill-title">${annotate(b.title || "")}</div>
        ${b.raw_subject ? `<div class="summary">${annotate(b.raw_subject)}</div>` : ""}
      </td>
      <td class="col-subj">${subjPills || '<span class="meta">—</span>'}</td>
      <td class="col-date">${escapeHtml(b.introduced_date)}</td>
      <td class="col-action">${escapeHtml(b.last_action || b.last_action_date)}</td>
      <td class="col-status">${escapeHtml(b.status)}</td>
    `;
    return tr;
  }

  function applyFilters() {
    const filtered = filterBills();
    const tbody = document.querySelector("#results tbody");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const b of filtered.slice(0, 1000)) frag.appendChild(renderRow(b));
    tbody.appendChild(frag);
    document.getElementById("result-count").textContent =
      `Showing ${Math.min(filtered.length, 1000)} of ${filtered.length} matching bills` +
      (filtered.length > 1000 ? " (first 1000)" : "");
  }

  function ingest(payload) {
    state.bills = payload.bills;
    setMeta(payload);
    buildFilters(payload);
    applyFilters();
  }

  async function load() {
    try {
      const r = await fetch("bills.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      ingest(await r.json());
    } catch (e) {
      const meta = document.getElementById("meta");
      // Keep stale data visible on a failed refresh; only surface error on first load.
      if (!state.bills.length) meta.textContent = "Failed to load bills.json: " + e.message;
    }
  }

  buildGlossaryPanel();
  load();

  // Self-update: poll periodically and whenever the tab regains focus, so a
  // long-open tab reflects the latest scrape without a manual reload.
  setInterval(load, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
})();
