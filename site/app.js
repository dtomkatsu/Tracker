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

  // Full set powers the glossary panel; the conservative INLINE subset is
  // auto-linked inside titles/summaries.
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

  const INLINE = [
    "TAT", "ADU", "TOD", "LIHTC", "HUD", "RPT", "TMK",
    "CZO", "ROH", "HRS", "CIP", "DPP", "SNAP", "WIC", "EBT", "SMA",
  ];
  const INLINE_RE = new RegExp("\\b(" + INLINE.join("|") + ")\\b", "g");
  const DRAFT_RE = /\b([HSC]D)(\d+)\b/g;
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

  // Each council reports status differently (Honolulu uses committee codes,
  // Maui says "Agenda Ready", Hawaii County has real reading stages, Kauai is
  // sparse). Collapse the mess into a small set of plain-language stages that
  // a regular person can follow, derived from the status field + last action.
  // Order matters: terminal/late stages are checked before earlier ones.
  function normalizeStatus(b) {
    const s = (b.status || "").toLowerCase().trim();
    const a = (b.last_action || "").toLowerCase();
    // Strong signals from the status field first.
    if (/adopt|enact|became law|approved/.test(s)) return { label: "Adopted / enacted", cls: "st-law" };
    if (/fail|defeat|withdraw|died|reject/.test(s)) return { label: "Failed", cls: "st-failed" };
    if (/postpone|defer|tabled|held/.test(s)) return { label: "Stalled", cls: "st-stalled" };
    if (/second.*reading|final reading/.test(s)) return { label: "Passed final reading", cls: "st-pass" };
    if (/first reading/.test(s)) return { label: "Passed 1st reading", cls: "st-progress" };
    if (/committee/.test(s)) return { label: "In committee", cls: "st-progress" };
    // Then the descriptive last-action text.
    if (/became law|enacted|signed by the mayor/.test(a)) return { label: "Adopted / enacted", cls: "st-law" };
    if (/second\s*(?:&|and)?\s*(?:final\s*)?reading|passes second|final reading/.test(a)) return { label: "Passed final reading", cls: "st-pass" };
    if (/first reading|passes first/.test(a)) return { label: "Passed 1st reading", cls: "st-progress" };
    if (/postpone|deferred|tabled|recommit|continued/.test(a)) return { label: "Stalled", cls: "st-stalled" };
    if (/\bfail|defeat|withdraw|killed|not adopt/.test(a)) return { label: "Failed", cls: "st-failed" };
    if (/adopts? res|\badopted\b/.test(a)) return { label: "Adopted / enacted", cls: "st-law" };
    if (/committee|referred|forwarded|recommend/.test(a)) return { label: "In committee", cls: "st-progress" };
    if (/introduc/.test(a)) return { label: "Introduced", cls: "st-early" };
    if (/agenda|scheduled/.test(a) || /agenda ready/.test(s)) return { label: "Scheduled", cls: "st-early" };
    if (s) return { label: "In progress", cls: "st-progress" };
    return { label: "Tracking", cls: "st-unknown" };
  }

  // The 5 steps of a county bill's life. We place each bill on this track and
  // mark whether it's still moving (active), done (enacted), or off-track
  // (stalled / failed).
  const STEP_NAMES = ["Introduced", "Committee", "1st reading", "Final reading", "Enacted"];

  // Step derived from the normalized label so the stepper always agrees with
  // the stage badge (council status fields can disagree with last-action text).
  const STEP_OF = {
    "Introduced": 0, "Scheduled": 0, "Tracking": 0,
    "In committee": 1, "In progress": 1,
    "Passed 1st reading": 2,
    "Passed final reading": 3,
    "Adopted / enacted": 4,
    "Stalled": 1, "Failed": 1,
  };

  function billProgress(b) {
    const st = normalizeStatus(b);
    let step = STEP_OF[st.label] ?? 0;
    let state = "active";
    if (st.cls === "st-law") { state = "done"; step = 4; }
    else if (st.cls === "st-failed") state = "failed";
    else if (st.cls === "st-stalled") state = "stalled";
    else if (st.cls === "st-unknown") state = "unknown";
    // For off-track bills, place the marker at the furthest stage reached.
    if (state === "failed" || state === "stalled") {
      const t = ((b.last_action || "") + " " + (b.status || "")).toLowerCase();
      if (/second.*reading|final reading|passes second/.test(t)) step = 3;
      else if (/first reading|passes first/.test(t)) step = 2;
      else if (/committee|referred|forwarded|recommend/.test(t)) step = 1;
    }
    return { step, state, label: st.label };
  }

  function renderStepper(prog, labeled) {
    const { step, state } = prog;
    let html = `<div class="stepper${labeled ? " stepper-labeled" : ""}">`;
    for (let i = 0; i < 5; i++) {
      let dot;
      if (state === "done" || i < step) dot = "done";
      else if (i === step) dot = "current-" + state;
      else dot = "future";
      const seg = (state === "done" || i < step) && i < 4 ? " seg-done" : "";
      html += `<div class="step ${dot}${seg}"><span class="dot"></span>${
        labeled ? `<span class="step-name">${STEP_NAMES[i]}</span>` : ""
      }</div>`;
    }
    return html + "</div>";
  }

  // A readable headline for a bill: prefer the parenthetical short-title that
  // councils tack on (e.g. "(Long-Term Affordable Rental Requirements)"),
  // otherwise the title with the "A BILL FOR AN ORDINANCE…" boilerplate trimmed.
  function billHeadline(b) {
    const t = (b.title || "").trim();
    if (!t) return "";
    const parens = [...t.matchAll(/\(([^)]{5,90})\)/g)]
      .map((x) => x[1].replace(/\s{2,}/g, " ").trim())
      .filter((p) => !/^draft\s*\d+$/i.test(p) && !/^\d+$/.test(p) && !/public hearing/i.test(p));
    if (parens.length) return parens[0];
    return t.replace(/^A BILL FOR AN ORDINANCE\s+/i, "").replace(/^A RESOLUTION\s+/i, "").trim() || t;
  }

  // Escape, then wrap recognized acronyms in <abbr> tooltips. One pass per
  // pattern over already-escaped text — no nesting or double substitution.
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
      `Data current as of ${when} (${relTime(ts)}) · updates daily`;
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

  // Multi-select checkbox group with a leading "All" box. "All" checks/unchecks
  // every option; checking all options re-checks "All". `opts.pill` renders each
  // option as its colored subject pill (used for the Subject group).
  function renderCheckGroup(containerId, items, selectedSet, opts = {}) {
    const c = document.getElementById(containerId);
    c.innerHTML = "";
    const itemBoxes = [];

    const allLabel = document.createElement("label");
    allLabel.className = "chk-all";
    const allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.checked = selectedSet.size === items.length;
    const allTxt = document.createElement("span");
    allTxt.textContent = "All";
    allLabel.append(allCb, allTxt);
    c.appendChild(allLabel);

    for (const it of items) {
      const label = document.createElement("label");
      label.className = opts.pill ? "subj-check" : "county-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedSet.has(it.value);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedSet.add(it.value);
        else selectedSet.delete(it.value);
        allCb.checked = selectedSet.size === items.length;
        applyFilters();
      });
      let node;
      if (opts.pill) {
        node = document.createElement("span");
        node.className = "subject-pill " + it.value;
        node.textContent = it.label;
      } else {
        node = document.createElement("span");
        node.textContent = it.label;
      }
      label.append(cb, node);
      c.appendChild(label);
      itemBoxes.push({ cb, value: it.value });
    }

    allCb.addEventListener("change", () => {
      selectedSet.clear();
      if (allCb.checked) for (const it of items) selectedSet.add(it.value);
      for (const { cb, value } of itemBoxes) cb.checked = selectedSet.has(value);
      applyFilters();
    });
  }

  function uniqueSorted(arr) {
    return [...new Set(arr.filter(Boolean))].sort();
  }

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
    // Default to everything selected ("All" checked) on first load.
    if (!filtersWired) {
      payload.councils.forEach((c) => state.councils.add(c));
      payload.subjects.forEach((s) => state.subjects.add(s));
    }
    state.councilUniverse = payload.councils.length;
    state.subjectUniverse = payload.subjects.length;

    renderCheckGroup(
      "f-council",
      payload.councils.map((c) => ({ value: c, label: COUNCIL_LABEL[c] || c })),
      state.councils
    );
    renderCheckGroup(
      "f-subject",
      payload.subjects.map((s) => ({ value: s, label: SUBJECT_LABEL[s] || s })),
      state.subjects,
      { pill: true }
    );
    populateSelect("f-type", uniqueSorted(payload.bills.map((b) => b.bill_type)));
    populateSelect("f-status", uniqueSorted(payload.bills.map((b) => normalizeStatus(b).label)));

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
    const countyAll = state.councils.size === state.councilUniverse;
    const subjectAll = state.subjects.size === state.subjectUniverse;
    return state.bills.filter((b) => {
      // "All" checked → no constraint on that dimension; otherwise the bill
      // must match a checked box (empty selection → nothing).
      if (!countyAll && !state.councils.has(b.council)) return false;
      if (!subjectAll) {
        if (!b.subjects?.some((s) => state.subjects.has(s))) return false;
      } else if (state.onlyClassified && (!b.subjects || b.subjects.length === 0)) {
        return false;
      }
      if (state.type && b.bill_type !== state.type) return false;
      if (state.status && normalizeStatus(b).label !== state.status) return false;
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

  // Returns [mainRow, detailRow]. The detail row spans all columns so the
  // description gets the full table width instead of the narrow Title column.
  function renderRows(b) {
    const council = COUNCIL_LABEL[b.council] || b.council;
    const pills = (b.subjects || [])
      .map(
        (s) =>
          `<span class="subject-pill ${s}" title="${SUBJECT_LABEL[s] || s}">${SUBJECT_LABEL[s] || s}</span>`
      )
      .join("");

    let lastAction = "";
    if (b.last_action) {
      lastAction = b.last_action + (b.last_action_date ? ` (${b.last_action_date})` : "");
    } else if (b.last_action_date) {
      lastAction = b.last_action_date;
    }
    const prog = billProgress(b);
    const fullTitle = (b.title || "").trim();
    const head = billHeadline(b);
    let sub = "";
    if (head && fullTitle && head !== fullTitle) sub = fullTitle;
    else if (b.raw_subject && b.raw_subject !== fullTitle) sub = b.raw_subject;

    const tr = document.createElement("tr");
    tr.className = "bill-row";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-expanded", "false");
    tr.innerHTML = `
      <td class="col-council">${escapeHtml(council)}</td>
      <td class="col-num"><a class="bill-link" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.bill_number)}</a></td>
      <td class="col-type">${escapeHtml(b.bill_type)}</td>
      <td class="col-title">
        <div class="title-line"><span class="caret" aria-hidden="true">▸</span><span class="title-text">${annotate(head || fullTitle || "")}</span></div>
        ${sub ? `<div class="title-preview">${annotate(sub)}</div>` : ""}
      </td>
      <td class="col-subj">${pills || '<span class="muted">—</span>'}</td>
      <td class="col-status" title="${escapeHtml(b.last_action || b.status || "")}">
        ${renderStepper(prog, false)}
        <div class="stage-label">${prog.label}</div>
        ${b.last_action_date ? `<div class="status-date">${escapeHtml(b.last_action_date)}</div>` : ""}
      </td>
    `;

    const detail = document.createElement("tr");
    detail.className = "detail-row";
    detail.hidden = true;
    const summaryLabel = b.council === "honolulu" ? "Summary" : "Committee / body";
    const parts = [`<div class="detail-progress">${renderStepper(prog, true)}</div>`];
    if (b.raw_subject) {
      parts.push(
        `<div class="detail-summary"><span class="detail-label">${summaryLabel}</span>${annotate(b.raw_subject)}</div>`
      );
    } else {
      parts.push(`<div class="detail-summary muted">No description available from the council source.</div>`);
    }
    const metaBits = [];
    if (b.introducer) metaBits.push(`<span><span class="detail-label">Introducer</span>${escapeHtml(b.introducer)}</span>`);
    if (b.introduced_date) metaBits.push(`<span><span class="detail-label">Introduced</span>${escapeHtml(b.introduced_date)}</span>`);
    if (lastAction) metaBits.push(`<span><span class="detail-label">Last action</span>${escapeHtml(lastAction)}</span>`);
    metaBits.push(`<span><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">View on council site ↗</a></span>`);
    parts.push(`<div class="detail-meta">${metaBits.join("")}</div>`);
    detail.innerHTML = `<td colspan="6"><div class="detail-inner">${parts.join("")}</div></td>`;

    function toggle() {
      const open = tr.classList.toggle("open");
      detail.hidden = !open;
      tr.setAttribute("aria-expanded", open ? "true" : "false");
    }
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // let the bill link open normally
      toggle();
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    return [tr, detail];
  }

  function applyFilters() {
    const filtered = filterBills();
    const tbody = document.querySelector("#results tbody");
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const b of filtered.slice(0, 1000)) {
      const [row, detail] = renderRows(b);
      frag.appendChild(row);
      frag.appendChild(detail);
    }
    tbody.appendChild(frag);
    document.getElementById("result-count").textContent =
      `${filtered.length} bill${filtered.length === 1 ? "" : "s"}` +
      (filtered.length > 1000 ? " (showing first 1000)" : "");
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
      if (!state.bills.length) {
        document.getElementById("result-count").textContent =
          "Failed to load bills.json: " + e.message;
      }
    }
  }

  buildGlossaryPanel();
  load();

  // Data refreshes once a day (scrape runs daily), so poll daily and also
  // re-fetch whenever the tab regains focus — preserving active filters.
  setInterval(load, 24 * 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
})();
