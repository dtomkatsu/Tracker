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

  // Favorites are persisted client-side (localStorage) — no backend, so they
  // live per-browser/device. Keyed by council|bill_number, which is stable
  // across re-scrapes and DB rebuilds (unlike the numeric id).
  const FAV_STORE = "tracker:favorites";
  function loadFavSet() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_STORE) || "[]")); }
    catch { return new Set(); }
  }
  function favKey(b) { return b.council + "|" + b.bill_number; }

  const state = {
    bills: [],
    councils: new Set(),
    subjects: new Set(),
    years: new Set(),
    types: new Set(),
    statuses: new Set(["Active"]),
    search: "",
    onlyClassified: true,
    favorites: loadFavSet(),
    favoritesOnly: false,
    sort: "recent",
  };

  // Sort the filtered list. "recent"/"oldest" key off the latest action date
  // (falling back to introduced / first-seen); "number" is a natural sort.
  function sortBills(arr) {
    if (state.sort === "number") {
      return arr.slice().sort((a, b) =>
        (a.bill_number || "").localeCompare(b.bill_number || "", undefined, { numeric: true }));
    }
    const dir = state.sort === "oldest" ? 1 : -1;
    const key = (b) => b.last_action_date || b.introduced_date || b.first_seen || "";
    return arr.slice().sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka === kb ? 0 : (ka < kb ? -dir : dir);
    });
  }

  function saveFavs() {
    try { localStorage.setItem(FAV_STORE, JSON.stringify([...state.favorites])); }
    catch { /* storage disabled/full — favorites just won't persist this session */ }
  }
  function toggleFav(b) {
    const k = favKey(b);
    if (state.favorites.has(k)) state.favorites.delete(k);
    else state.favorites.add(k);
    saveFavs();
    syncListHash();
    updateFavCount();
  }
  function updateFavCount() {
    const el = document.getElementById("fav-count");
    if (el) el.textContent = state.favorites.size ? ` (${state.favorites.size})` : "";
  }
  function favButtonHtml(b) {
    const on = state.favorites.has(favKey(b));
    return `<button class="fav-btn${on ? " is-fav" : ""}" type="button" aria-pressed="${on}" ` +
      `title="${on ? "Remove from favorites" : "Save to favorites"}" ` +
      `aria-label="${on ? "Remove bill from favorites" : "Save bill to favorites"}">${on ? "★" : "☆"}</button>`;
  }

  // Mirror the starred set (and the favorites-only view) into the URL hash, so
  // bookmarking or copying the page link reopens the exact list anywhere — no
  // backend. localStorage remains the everyday store; the hash is the portable
  // copy that travels in a bookmark.
  function syncListHash() {
    let hash = "";
    if (state.favorites.size) {
      const payload = { f: [...state.favorites], o: state.favoritesOnly ? 1 : 0 };
      hash = "#list=" + encodeURIComponent(JSON.stringify(payload));
    }
    history.replaceState(null, "", hash || location.pathname + location.search);
  }
  // On load, fold any list from the URL into the local favorites (union — never
  // drops stars already saved on this device) and restore the favorites-only view.
  function restoreListFromHash() {
    const m = /[#&]list=([^&]+)/.exec(location.hash);
    if (!m) return;
    let payload;
    try { payload = JSON.parse(decodeURIComponent(m[1])); } catch { return; }
    let changed = false;
    for (const k of payload.f || []) {
      if (!state.favorites.has(k)) { state.favorites.add(k); changed = true; }
    }
    if (changed) saveFavs();
    if (payload.o) state.favoritesOnly = true;
  }

  // Bill types collapse into 3 plain buckets. Councils emit ~9 raw types, most
  // of them procedural noise a regular reader doesn't care about.
  const TYPE_BUCKETS = ["Laws", "Resolutions", "Procedural & ceremonial"];
  function typeBucket(t) {
    const x = (t || "").toLowerCase().trim();
    if (x === "bill" || x === "ordinance") return "Laws";
    if (x === "resolution") return "Resolutions";
    return "Procedural & ceremonial"; // committee reports, Rule 7(B), ceremonial, etc.
  }

  // The 10 normalized status labels collapse into 3 outcome buckets for the
  // filter dropdown. The per-row stepper still shows the precise stage.
  const STATUS_BUCKETS = ["Active", "Passed", "Dead"];
  const STATUS_BUCKET_OF = {
    "Introduced": "Active", "Scheduled": "Active", "In committee": "Active",
    "In progress": "Active", "Passed 1st reading": "Active",
    "Passed final reading": "Active", "Tracking": "Active",
    "Adopted / enacted": "Passed",
    "Stalled": "Dead", "Failed": "Dead",
  };
  function statusBucket(b) {
    return STATUS_BUCKET_OF[normalizeStatus(b).label] || "Active";
  }

  // Year a bill belongs to: prefer introduced date, fall back to last action.
  function billYear(b) {
    const d = b.introduced_date || b.last_action_date || "";
    return /^\d{4}/.test(d) ? d.slice(0, 4) : null;
  }

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

  // A readable headline for a bill — what it's actually ABOUT, not the legal
  // framing. Built from, in order of preference:
  //   1. the subject of the "RELATING TO …" clause (the legal statement of
  //      what the measure covers), combined with
  //   2. a trailing parenthetical short-title when the council tacked one on
  //      (e.g. "(Long-Term Affordable Rental Requirements)") — trailing only:
  //      mid-title parentheticals are legal asides like "(2016 EDITION, AS
  //      AMENDED)" or "(Public Laws 93-383 And 100-242)", not short titles;
  //   3. otherwise the full title with lead-in boilerplate trimmed.
  // ALL-CAPS results are converted to readable title case (known acronyms kept).
  const PAREN_NOISE_RE = new RegExp(
    "^draft\\s*\\d|^\\d+$|^\\d{4}\\b|public hearing|edition|as amended" +
    "|public law|^see\\b|^memo|^comm\\b|\\bno\\.\\s*\\d|^for condemnation$",
    "i"
  );
  const SMALL_WORDS = new Set([
    "a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with",
  ]);
  const KNOWN_ACRONYMS = new Set([
    ...Object.keys(GLOSSARY),
    "USA", "US", "HSAC", "CDBG", "PEG", "YWCA", "YMCA", "FY", "II", "III", "IV",
  ]);

  // A string counts as ALL-CAPS when it has no real lowercase or Title-case
  // word — isolated lowercase letters inside codes ("A-20a", "RS-10a") don't
  // disqualify it.
  function isAllCaps(s) {
    return !/\b[a-z]{2,}|[A-Z][a-z]{2,}/.test(s);
  }

  // Convert an ALL-CAPS legal title to title case; mixed-case input is
  // returned untouched. Words the glossary knows (HUD, RPT, …) stay caps so
  // the acronym tooltips still match, and mixed-case codes ("A-20a") are kept.
  function readableCase(s) {
    if (!s || !isAllCaps(s)) return s;
    let first = true;
    return s.replace(/[\p{L}\p{N}'’‘ʻ-]+/gu, (w) => {
      if (KNOWN_ACRONYMS.has(w)) return w;
      if (/[a-z]/.test(w)) return w; // zoning/code token like "A-20a"
      const lw = w.toLowerCase();
      if (!first && SMALL_WORDS.has(lw)) return lw;
      first = false;
      return lw
        .split("-")
        .map((seg) => (SMALL_WORDS.has(seg) ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
        .join("-");
    });
  }

  // Records scraped before summary/title separation carry the Title-case staff
  // summary glued onto the ALL-CAPS legal title ("…AND GARAGES Removes
  // commercial parking lots…"); keep only the caps title.
  function capsCore(t) {
    const m = t.match(/[A-Z][a-z]{2,}/);
    if (!m || m.index < 30) return t;
    const prefix = t.slice(0, m.index);
    return isAllCaps(prefix) ? prefix.trim() : t;
  }

  // A short-title tag the council appended at the END of the title; mid-title
  // parentheticals are statutory asides and never used as headlines.
  function shortTitleTag(t) {
    const m = t.match(/\(([^()]{5,90})\)\s*\.?\s*$/);
    if (!m) return "";
    const p = m[1].replace(/\s{2,}/g, " ").trim();
    if (PAREN_NOISE_RE.test(p)) return "";
    if (p.split(/\s+/).length < 2 || !/[A-Za-z]{3}/.test(p)) return "";
    return p;
  }

  function billHeadline(b) {
    const raw = (b.title || "").trim();
    if (!raw) return "";
    const tag = shortTitleTag(raw);
    // A trailing short-title tag means the title is already clean; otherwise
    // shear off any staff summary glued onto an ALL-CAPS title.
    const t = tag ? raw : capsCore(raw);
    // "RELATING TO X" / "RELATES TO X": X is the substance. Stop at a
    // parenthetical, sentence end, or a trailing fiscal-year span.
    const rel = t.match(
      /\bRELAT(?:ING|ES|ED)\s+TO\s+(?:THE\s+)?(.+?)(?=\s*\(|\s*[.;]|\s+FOR\s+THE\s+FISCAL\s+YEAR\b|\s*$)/i
    );
    const subject = rel && rel[1].trim().replace(/,\s*$/, "");
    if (subject && tag) return `${readableCase(subject)} — ${readableCase(tag)}`;
    if (tag) return readableCase(tag);
    if (subject && (subject.split(/\s+/).length >= 2 || subject.length >= 6)) {
      return readableCase(subject);
    }
    const trimmed = t
      .replace(/^A BILL FOR AN ORDINANCE\s+/i, "")
      .replace(/^AN?\s+ORDINANCE\s+/i, "")
      .replace(/^A BILL\s+(?:TO|FOR)\s+/i, "")
      .replace(/^A RESOLUTION\s+/i, "")
      // "RESOLUTION 26-84, …" / "BILL 61 (2026), …" — the number repeats the
      // Number column; keep only what follows.
      .replace(/^(?:BILL|RESOLUTION)\s+(?:NO\.?\s*)?\d[\d-]*\s*(?:\(\d{4}\))?\s*,\s*/i, "")
      .replace(/^RESOLUTION\s+/i, "")
      // trailing committee file code, e.g. "(BFED-60)" or "(WASSP-1(20))"
      .replace(/\s*\(\s*[A-Za-z]{2,8}-\d+(?:\([^)]*\))?[^)]*\)\s*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return readableCase(trimmed) || t;
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
    const exact = ts ? new Date(ts).toLocaleString() : "—";
    const rel = ts ? relTime(ts) : exact;
    const el = document.getElementById("meta");
    el.innerHTML =
      `<span class="live-dot" aria-hidden="true"></span>` +
      `<span>Updated ${escapeHtml(rel)}</span>` +
      `<span class="meta-sep" aria-hidden="true">·</span>` +
      `<span>refreshes Mon, Wed &amp; Fri</span>`;
    el.title = `Data current as of ${exact}`;
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
      const node = document.createElement("span");
      node.className = opts.pill ? "subject-pill " + it.value : "county-badge";
      node.textContent = it.label;
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

  // Column-header filter popovers (County, Subjects). The menu inside each is
  // the same renderCheckGroup() checkbox group that used to sit in the filter
  // card — just rendered into a popover anchored under the column header.
  let openColPop = null;
  function closeColPop(restoreFocus) {
    if (!openColPop) return;
    const btn = openColPop.btn;
    openColPop.pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    openColPop = null;
    if (restoreFocus) btn.focus();
  }
  function positionColPop(btn, pop) {
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 4) + "px";
    let left = r.left;
    if (left + pop.offsetWidth > window.innerWidth - 8) {
      left = window.innerWidth - pop.offsetWidth - 8;
    }
    pop.style.left = Math.max(8, Math.round(left)) + "px";
  }
  function wireColumnFilter(btnId, popId) {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    if (!btn || !pop) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openColPop && openColPop.pop === pop;
      closeColPop();
      if (!wasOpen) {
        pop.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        openColPop = { btn, pop };
        positionColPop(btn, pop);
        pop.querySelector("input")?.focus(); // a11y: move focus into the menu
      }
    });
    pop.addEventListener("click", (e) => e.stopPropagation());
    // a11y: tabbing (or clicking) out of the menu closes it
    pop.addEventListener("focusout", (e) => {
      if (e.relatedTarget && e.relatedTarget !== btn && !pop.contains(e.relatedTarget)) {
        closeColPop(false);
      }
    });
  }
  // Reflect an applied (non-"All") filter on the header: highlight + a count badge.
  function updateColumnFilterIndicators() {
    for (const [id, n, total] of [
      ["cf-council-btn", state.councils.size, state.councilUniverse],
      ["cf-subject-btn", state.subjects.size, state.subjectUniverse],
      ["cf-type-btn", state.types.size, state.typeUniverse],
      ["cf-status-btn", state.statuses.size, state.statusUniverse],
    ]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      const active = !!(total && n < total);
      btn.classList.toggle("is-active", active);
      const badge = btn.querySelector(".cf-badge");
      if (badge) {
        badge.hidden = !active;
        badge.textContent = active ? String(n) : "";
      }
    }
  }

  // Render all five checkbox groups from the stashed item lists + current Sets.
  // Used on load and after a chip removal / reset re-syncs the Sets.
  function renderFilterGroups() {
    const it = state._items;
    if (!it) return;
    // Desktop renders into the column-header popovers (f-*); mobile mirrors the
    // same groups into the always-visible filter card (mf-*), since the header
    // popovers aren't reachable once the table collapses to cards.
    const groups = [
      ["council", it.council, state.councils, undefined],
      ["year", it.year, state.years, undefined],
      ["subject", it.subject, state.subjects, { pill: true }],
      ["type", it.type, state.types, undefined],
      ["status", it.status, state.statuses, undefined],
    ];
    for (const [name, items, set, opts] of groups) {
      if (document.getElementById("f-" + name)) renderCheckGroup("f-" + name, items, set, opts);
      if (document.getElementById("mf-" + name)) renderCheckGroup("mf-" + name, items, set, opts);
    }
  }
  function setAll(set, items) {
    set.clear();
    (items || []).forEach((x) => set.add(x.value));
  }

  // Removable chips summarizing the applied (non-default) filters, with Reset all.
  function renderActiveFilters() {
    const host = document.getElementById("active-filters");
    if (!host) return;
    const it = state._items || {};
    const labelOf = (arr, v) => (arr?.find((x) => x.value === v)?.label) ?? v;
    const chips = [];
    const dimChip = (dim, set, items, name) => {
      if (!items || set.size === items.length) return; // "all" → no chip
      const text = set.size === 1 ? `${name}: ${labelOf(items, [...set][0])}`
        : set.size === 0 ? `${name}: none` : `${name}: ${set.size}`;
      chips.push({ dim, text });
    };
    dimChip("council", state.councils, it.council, "County");
    dimChip("type", state.types, it.type, "Type");
    dimChip("subject", state.subjects, it.subject, "Subject");
    dimChip("status", state.statuses, it.status, "Status");
    dimChip("year", state.years, it.year, "Year");
    if (state.favoritesOnly) chips.push({ dim: "fav", text: "★ Favorites" });
    if (state.search) chips.push({ dim: "search", text: `Search: “${state.search}”` });

    host.innerHTML = "";
    if (!chips.length) { host.hidden = true; return; }
    host.hidden = false;
    const lbl = document.createElement("span");
    lbl.className = "af-label";
    lbl.textContent = "Filters:";
    host.appendChild(lbl);
    for (const c of chips) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "af-chip";
      b.dataset.dim = c.dim;
      b.setAttribute("aria-label", `Remove filter ${c.text}`);
      b.innerHTML = `${escapeHtml(c.text)} <span class="af-x" aria-hidden="true">✕</span>`;
      host.appendChild(b);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "af-reset";
    reset.textContent = "Reset all";
    host.appendChild(reset);
  }
  function clearFilterDim(dim) {
    const it = state._items || {};
    if (dim === "council") setAll(state.councils, it.council);
    else if (dim === "type") setAll(state.types, it.type);
    else if (dim === "subject") setAll(state.subjects, it.subject);
    else if (dim === "status") setAll(state.statuses, it.status);
    else if (dim === "year") setAll(state.years, it.year);
    else if (dim === "fav") {
      state.favoritesOnly = false;
      const cb = document.getElementById("f-favorites"); if (cb) cb.checked = false;
      syncListHash();
    } else if (dim === "search") {
      state.search = "";
      const s = document.getElementById("f-search"); if (s) s.value = "";
    const sc = document.getElementById("f-search-clear"); if (sc) sc.hidden = true;
    }
    renderFilterGroups();
    applyFilters();
  }
  function resetAllFilters() {
    const it = state._items || {};
    setAll(state.councils, it.council);
    setAll(state.subjects, it.subject);
    setAll(state.types, it.type);
    state.statuses.clear(); state.statuses.add("Active");
    state.years.clear(); if (it.year && it.year[0]) state.years.add(it.year[0].value);
    state.search = "";
    const s = document.getElementById("f-search"); if (s) s.value = "";
    const sc = document.getElementById("f-search-clear"); if (sc) sc.hidden = true;
    state.favoritesOnly = false;
    const cb = document.getElementById("f-favorites"); if (cb) cb.checked = false;
    state.onlyClassified = true;
    const cc = document.getElementById("f-classified"); if (cc) cc.checked = true;
    syncListHash();
    renderFilterGroups();
    applyFilters();
  }

  let filtersWired = false;

  function buildFilters(payload) {
    // Default to everything selected ("All" checked) on first load.
    // Years present in the data, newest first.
    const years = [...new Set(payload.bills.map(billYear).filter(Boolean))].sort().reverse();
    const typesPresent = TYPE_BUCKETS.filter((t) => payload.bills.some((b) => typeBucket(b.bill_type) === t));
    const statusesPresent = STATUS_BUCKETS.filter((s) => payload.bills.some((b) => statusBucket(b) === s));
    if (!filtersWired) {
      payload.councils.forEach((c) => state.councils.add(c));
      payload.subjects.forEach((s) => state.subjects.add(s));
      typesPresent.forEach((t) => state.types.add(t)); // default: all types (no filter)
      // statuses default to {Active} (state init); Year defaults to newest only.
      if (years.length) state.years.add(years[0]);
    }
    state.councilUniverse = payload.councils.length;
    state.subjectUniverse = payload.subjects.length;
    state.yearUniverse = years.length;
    state.typeUniverse = typesPresent.length;
    state.statusUniverse = statusesPresent.length;

    state._items = {
      council: payload.councils.map((c) => ({ value: c, label: COUNCIL_LABEL[c] || c })),
      year: years.map((y) => ({ value: y, label: y })),
      subject: payload.subjects.map((s) => ({ value: s, label: SUBJECT_LABEL[s] || s })),
      type: typesPresent.map((t) => ({ value: t, label: t })),
      status: statusesPresent.map((s) => ({ value: s, label: s })),
    };
    renderFilterGroups();

    if (filtersWired) return;
    filtersWired = true;
    const searchInput = document.getElementById("f-search");
    const searchClear = document.getElementById("f-search-clear");
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value.toLowerCase().trim();
      if (searchClear) searchClear.hidden = !e.target.value;
      applyFilters();
    });
    if (searchClear) searchClear.addEventListener("click", () => {
      searchInput.value = "";
      state.search = "";
      searchClear.hidden = true;
      applyFilters();
      searchInput.focus();
    });
    const sortSel = document.getElementById("f-sort");
    if (sortSel) sortSel.addEventListener("change", (e) => {
      state.sort = e.target.value;
      applyFilters();
    });
    document.getElementById("f-classified").addEventListener("change", (e) => {
      state.onlyClassified = e.target.checked;
      applyFilters();
    });
    document.getElementById("f-favorites").addEventListener("change", (e) => {
      state.favoritesOnly = e.target.checked;
      syncListHash();
      applyFilters();
    });
    const copyBtn = document.getElementById("copy-list");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        syncListHash();
        const restore = () => { copyBtn.textContent = "🔗 Copy link to my list"; };
        if (!state.favorites.size) {
          copyBtn.textContent = "Star some bills first";
          setTimeout(restore, 1800);
          return;
        }
        try {
          await navigator.clipboard.writeText(location.href);
          copyBtn.textContent = "✓ Link copied — bookmark it";
        } catch {
          copyBtn.textContent = "Copy the page URL from the address bar";
        }
        setTimeout(restore, 2200);
      });
    }
    wireColumnFilter("cf-council-btn", "cf-council-pop");
    wireColumnFilter("cf-subject-btn", "cf-subject-pop");
    wireColumnFilter("cf-type-btn", "cf-type-pop");
    wireColumnFilter("cf-status-btn", "cf-status-pop");
    const af = document.getElementById("active-filters");
    if (af) af.addEventListener("click", (e) => {
      if (e.target.closest(".af-reset")) return resetAllFilters();
      const chip = e.target.closest(".af-chip");
      if (chip) clearFilterDim(chip.dataset.dim);
    });
    document.addEventListener("click", () => closeColPop(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeColPop(true); });
    window.addEventListener("scroll", () => closeColPop(false), true);
    window.addEventListener("resize", () => closeColPop(false));
    updateFavCount();
  }

  function filterBills() {
    const countyAll = state.councils.size === state.councilUniverse;
    const subjectAll = state.subjects.size === state.subjectUniverse;
    const yearAll = state.years.size === state.yearUniverse;
    const typeAll = state.types.size === state.typeUniverse;
    const statusAll = state.statuses.size === state.statusUniverse;
    return state.bills.filter((b) => {
      if (state.favoritesOnly && !state.favorites.has(favKey(b))) return false;
      // "All" checked → no constraint on that dimension; otherwise the bill
      // must match a checked box (empty selection → nothing).
      if (!countyAll && !state.councils.has(b.council)) return false;
      if (!yearAll && !state.years.has(billYear(b))) return false;
      if (!subjectAll) {
        if (!b.subjects?.some((s) => state.subjects.has(s))) return false;
      } else if (state.onlyClassified && (!b.subjects || b.subjects.length === 0)) {
        return false;
      }
      if (!typeAll && !state.types.has(typeBucket(b.bill_type))) return false;
      if (!statusAll && !state.statuses.has(statusBucket(b))) return false;
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
      <td class="col-fav">${favButtonHtml(b)}</td>
      <td class="col-council" data-label="County">${escapeHtml(council)}</td>
      <td class="col-num" data-label="Number"><a class="bill-link" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.bill_number)}</a></td>
      <td class="col-type" data-label="Type">${escapeHtml(b.bill_type)}</td>
      <td class="col-title" data-label="Title">
        <div class="title-line"><span class="caret" aria-hidden="true">▸</span><span class="title-text">${annotate(head || fullTitle || "")}</span></div>
        ${sub ? `<div class="title-preview">${annotate(sub)}</div>` : ""}
      </td>
      <td class="col-subj" data-label="Subjects">${pills || '<span class="muted">—</span>'}</td>
      <td class="col-status" data-label="Progress" title="${escapeHtml(b.last_action || b.status || "")}">
        ${renderStepper(prog, false)}
        <div class="stage-label">${prog.label}</div>
        ${b.last_action_date ? `<div class="status-date">${escapeHtml(b.last_action_date)}</div>` : ""}
      </td>
    `;

    const detail = document.createElement("tr");
    detail.className = "detail-row";
    detail.hidden = true;
    // Maui's raw_subject is the referring committee; everywhere else it is a
    // staff summary — or, when the council source has no separate summary
    // (Kauai), the full legal title, which is itself the best description.
    const summaryLabel =
      b.council === "maui" ? "Committee / body"
      : b.raw_subject && b.raw_subject !== fullTitle ? "Summary"
      : "Full title";
    // Progress is already shown in the row's Progress column, so the expanded
    // view skips the (redundant) labeled stepper and leads with the summary.
    const parts = [];
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
    // Gutter cells occupy the star+county columns so the expanded content lines
    // up under the bill's Number/Title block instead of floating at the far left.
    detail.innerHTML = `<td class="detail-gutter" colspan="2"></td>` +
      `<td colspan="5"><div class="detail-inner">${parts.join("")}</div></td>`;

    function toggle() {
      const open = tr.classList.toggle("open");
      detail.hidden = !open;
      tr.setAttribute("aria-expanded", open ? "true" : "false");
    }
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a") || e.target.closest(".fav-btn")) return;
      toggle();
    });
    tr.addEventListener("keydown", (e) => {
      if (e.target.closest(".fav-btn")) return; // star handles its own keys
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    // Star toggles the favorite without expanding the row.
    const favBtn = tr.querySelector(".fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(b);
      const on = state.favorites.has(favKey(b));
      favBtn.classList.toggle("is-fav", on);
      favBtn.setAttribute("aria-pressed", String(on));
      favBtn.textContent = on ? "★" : "☆";
      favBtn.title = on ? "Remove from favorites" : "Save to favorites";
      if (state.favoritesOnly) applyFilters(); // drop it from the filtered view
    });

    return [tr, detail];
  }

  function applyFilters() {
    const filtered = sortBills(filterBills());
    updateColumnFilterIndicators();
    renderActiveFilters();
    const tbody = document.querySelector("#results tbody");
    tbody.innerHTML = "";
    if (!filtered.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="empty-state">No bills match your filters. ` +
        `<button type="button" id="empty-reset" class="link-btn">Reset all filters</button></td>`;
      tbody.appendChild(tr);
      tbody.querySelector("#empty-reset").addEventListener("click", resetAllFilters);
    } else {
      const frag = document.createDocumentFragment();
      for (const b of filtered.slice(0, 1000)) {
        const [row, detail] = renderRows(b);
        frag.appendChild(row);
        frag.appendChild(detail);
      }
      tbody.appendChild(frag);
    }
    document.getElementById("result-count").textContent =
      `${filtered.length} bill${filtered.length === 1 ? "" : "s"}` +
      (filtered.length > 1000 ? " (showing first 1000)" : "");
  }

  function ingest(payload) {
    state.bills = payload.bills;
    setMeta(payload);
    buildFilters(payload);
    restoreListFromHash();
    const favCb = document.getElementById("f-favorites");
    if (favCb) favCb.checked = state.favoritesOnly;
    updateFavCount();
    applyFilters();
  }

  // Placeholder shimmer rows shown while bills.json downloads (1.7MB — visible
  // on a slow phone connection). Replaced by the real rows on first ingest.
  function renderSkeleton(n) {
    const tbody = document.querySelector("#results tbody");
    if (!tbody) return;
    tbody.innerHTML = Array.from({ length: n || 8 }).map(() =>
      `<tr class="skeleton-row"><td colspan="7"><div class="sk sk-title"></div><div class="sk sk-line"></div></td></tr>`
    ).join("");
  }

  async function load() {
    try {
      const r = await fetch("bills.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      ingest(await r.json());
    } catch (e) {
      if (!state.bills.length) {
        document.querySelector("#results tbody").innerHTML = "";
        document.getElementById("result-count").textContent =
          "Failed to load bills.json: " + e.message;
      }
    }
  }

  buildGlossaryPanel();
  renderSkeleton();
  load();

  // Scrape runs Mon/Wed/Fri, so a daily client poll is plenty; also re-fetch
  // whenever the tab regains focus — preserving active filters.
  setInterval(load, 24 * 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
})();
