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

  const state = {
    bills: [],
    councils: new Set(),
    subjects: new Set(),
    type: "",
    status: "",
    search: "",
    onlyClassified: true,
  };

  function setMeta(payload) {
    const meta = document.getElementById("meta");
    const ts = payload.last_scrape?.completed_at || payload.generated_at;
    const when = ts ? new Date(ts).toLocaleString() : "—";
    meta.textContent = `${payload.bills.length} bills tracked · last update ${when}`;
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

    const types = uniqueSorted(payload.bills.map((b) => b.bill_type));
    const typeSel = document.getElementById("f-type");
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      typeSel.appendChild(opt);
    }
    typeSel.addEventListener("change", (e) => {
      state.type = e.target.value;
      applyFilters();
    });

    const statuses = uniqueSorted(payload.bills.map((b) => b.status));
    const statusSel = document.getElementById("f-status");
    for (const s of statuses) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      statusSel.appendChild(opt);
    }
    statusSel.addEventListener("change", (e) => {
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
      <td>${council}</td>
      <td><a class="bill-link" href="${b.url}" target="_blank" rel="noopener">${
      b.bill_number
    }</a></td>
      <td>${b.bill_type || ""}</td>
      <td>
        <div class="bill-title">${escapeHtml(b.title || "")}</div>
        ${b.raw_subject ? `<div class="summary">${escapeHtml(b.raw_subject)}</div>` : ""}
      </td>
      <td>${subjPills || '<span class="meta">—</span>'}</td>
      <td>${b.introduced_date || ""}</td>
      <td>${b.last_action || b.last_action_date || ""}</td>
      <td>${b.status || ""}</td>
    `;
    return tr;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function applyFilters() {
    const filtered = filterBills();
    const tbody = document.querySelector("#results tbody");
    tbody.innerHTML = "";
    for (const b of filtered.slice(0, 1000)) tbody.appendChild(renderRow(b));
    document.getElementById("result-count").textContent =
      `Showing ${Math.min(filtered.length, 1000)} of ${filtered.length} matching bills` +
      (filtered.length > 1000 ? " (first 1000)" : "");
  }

  fetch("bills.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((payload) => {
      state.bills = payload.bills;
      setMeta(payload);
      buildFilters(payload);
      applyFilters();
    })
    .catch((e) => {
      document.getElementById("meta").textContent =
        "Failed to load bills.json: " + e.message;
    });
})();
