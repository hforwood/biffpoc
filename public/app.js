import { SPACE_TYPES, UK_COUNTIES } from "./options.js";

const countyOptions = UK_COUNTIES.map((county) => ({ label: county, value: county }));
const siteTypeOptions = SPACE_TYPES.map((type) => ({ label: titleCase(type), value: type }));

const statusOptions = [
  ["identified", "Identified"],
  ["contacted", "Contacted"],
  ["call_booked", "Call Booked"],
  ["rejected", "Rejected"],
  ["site_visit", "Site Visit"],
  ["closed_won", "Closed Won"]
];

const state = {
  searches: [],
  selectedSearchId: null,
  selectedLeadId: null,
  view: "site-search",
  imageTab: "annotated",
  searchFilter: "",
  leadFilter: "",
  searchSort: "created",
  searchSortDir: "desc",
  leadSort: "site",
  leadSortDir: "asc",
  selectedLeadIds: new Set(),
  postCodes: [],
  counties: [],
  radiusMiles: undefined,
  siteTypes: siteTypeOptions.map((type) => type.value)
};

const els = {
  siteSearchNav: document.querySelector("#siteSearchNav"),
  listsNav: document.querySelector("#listsNav"),
  siteSearchView: document.querySelector("#siteSearchView"),
  listView: document.querySelector("#listView"),
  searchForm: document.querySelector("#searchForm"),
  nameInput: document.querySelector("#nameInput"),
  postCodeInput: document.querySelector("#postCodeInput"),
  countyPicker: document.querySelector("#countyPicker"),
  radiusInput: document.querySelector("#radiusInput"),
  siteTypePicker: document.querySelector("#siteTypePicker"),
  numberSitesInput: document.querySelector("#numberSitesInput"),
  postCodeChips: document.querySelector("#postCodeChips"),
  countyChips: document.querySelector("#countyChips"),
  radiusChips: document.querySelector("#radiusChips"),
  siteTypeChips: document.querySelector("#siteTypeChips"),
  mockInput: document.querySelector("#mockInput"),
  aiInput: document.querySelector("#aiInput"),
  runSearchButton: document.querySelector("#runSearchButton"),
  searchesFilter: document.querySelector("#searchesFilter"),
  leadFilter: document.querySelector("#leadFilter"),
  searchRows: document.querySelector("#searchRows"),
  leadRows: document.querySelector("#leadRows"),
  leadSelectAll: document.querySelector("#leadSelectAll"),
  bulkActions: document.querySelector("#bulkActions"),
  bulkCount: document.querySelector("#bulkCount"),
  bulkStatus: document.querySelector("#bulkStatus"),
  bulkUpdateStatus: document.querySelector("#bulkUpdateStatus"),
  clearSelection: document.querySelector("#clearSelection"),
  backToSearch: document.querySelector("#backToSearch"),
  listTitle: document.querySelector("#listTitle"),
  addMoreButton: document.querySelector("#addMoreButton"),
  downloadCsvButton: document.querySelector("#downloadCsvButton"),
  drawer: document.querySelector("#drawer"),
  scrim: document.querySelector("#scrim"),
  closeDrawer: document.querySelector("#closeDrawer"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerStatus: document.querySelector("#drawerStatus"),
  drawerGood: document.querySelector("#drawerGood"),
  drawerBad: document.querySelector("#drawerBad"),
  feedbackNotes: document.querySelector("#feedbackNotes"),
  saveFeedback: document.querySelector("#saveFeedback"),
  siteImage: document.querySelector("#siteImage"),
  contactDetails: document.querySelector("#contactDetails"),
  aiScoring: document.querySelector("#aiScoring")
};

for (const [value, label] of statusOptions) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  els.drawerStatus.append(option);

  const bulkOption = document.createElement("option");
  bulkOption.value = value;
  bulkOption.textContent = label;
  els.bulkStatus.append(bulkOption);
}

const countyPicker = createMultiPicker({
  root: els.countyPicker,
  options: countyOptions,
  emptyLabel: "All",
  allLabel: "All Counties",
  searchPlaceholder: "Search",
  showSelectAll: false,
  getSelected: () => state.counties,
  setSelected: (values) => {
    state.counties = values;
    render();
  }
});

const siteTypePicker = createMultiPicker({
  root: els.siteTypePicker,
  options: siteTypeOptions,
  emptyLabel: "Choose Site Types",
  allLabel: "All Site Types",
  searchPlaceholder: "Search",
  showSelectAll: true,
  getSelected: () => state.siteTypes,
  setSelected: (values) => {
    state.siteTypes = values;
    render();
  }
});

document.querySelectorAll(".side-link[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "site-search") {
      showSearchView();
      return;
    }

    if (button.dataset.view === "list" && selectedSearch()) {
      state.view = "list";
      render();
    }
  });
});

document.querySelectorAll("[data-search-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    setSort("search", th.dataset.searchSort);
  });
});

document.querySelectorAll("[data-lead-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    setSort("lead", th.dataset.leadSort);
  });
});

els.postCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    addChip("postCodes", els.postCodeInput.value);
    els.postCodeInput.value = "";
  }
});

els.radiusInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    setRadiusFromInput();
  }
});

els.radiusInput.addEventListener("blur", setRadiusFromInput);

els.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.postCodeInput.value.trim()) {
    addChip("postCodes", els.postCodeInput.value);
    els.postCodeInput.value = "";
  }
  setRadiusFromInput();
  await runSearch();
});

els.searchesFilter.addEventListener("input", () => {
  state.searchFilter = els.searchesFilter.value;
  renderSearchRows();
});

els.leadFilter.addEventListener("input", () => {
  state.leadFilter = els.leadFilter.value;
  renderLeadRows();
});

els.backToSearch.addEventListener("click", showSearchView);
els.addMoreButton.addEventListener("click", addMoreSites);
els.downloadCsvButton.addEventListener("click", downloadSelectedCsv);
els.leadSelectAll.addEventListener("change", () => {
  const visibleLeads = sortedLeads(filteredLeads(selectedSearch()?.summary?.leads || []));
  for (const lead of visibleLeads) {
    if (els.leadSelectAll.checked) state.selectedLeadIds.add(lead.id);
    else state.selectedLeadIds.delete(lead.id);
  }
  renderLeadRows();
});
els.bulkUpdateStatus.addEventListener("click", bulkUpdateStatus);
els.clearSelection.addEventListener("click", () => {
  state.selectedLeadIds.clear();
  renderLeadRows();
});
els.closeDrawer.addEventListener("click", closeDrawer);
els.scrim.addEventListener("click", closeDrawer);

els.drawerStatus.addEventListener("change", () => {
  const lead = selectedLead();
  if (lead) updateReview(lead.id, { status: els.drawerStatus.value });
});

els.drawerGood.addEventListener("click", () => {
  const lead = selectedLead();
  if (lead) updateReview(lead.id, { isGood: true, notes: els.feedbackNotes.value });
});

els.drawerBad.addEventListener("click", () => {
  const lead = selectedLead();
  if (lead) updateReview(lead.id, { isGood: false, notes: els.feedbackNotes.value });
});

els.saveFeedback.addEventListener("click", () => {
  const lead = selectedLead();
  if (lead) updateReview(lead.id, { notes: els.feedbackNotes.value });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    state.imageTab = button.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
    renderDrawer();
  });
});

loadSearches();

async function loadSearches() {
  try {
    const data = await fetchJson("/api/searches");
    state.searches = data.searches || [];
    render();
  } catch (error) {
    alert(errorMessage(error));
  }
}

async function runSearch() {
  if (!state.postCodes.length && !state.counties.length) {
    alert("Enter at least one post code or select at least one county.");
    return;
  }

  if (!state.radiusMiles) {
    alert("Enter a search radius in miles.");
    return;
  }

  if (!state.siteTypes.length) {
    alert("Select at least one site type.");
    return;
  }

  els.runSearchButton.disabled = true;
  els.runSearchButton.textContent = "Running";

  const name = els.nameInput.value.trim() || defaultSearchName();
  const maxSites = Number(els.numberSitesInput.value || 20);
  const spaceTypes = state.siteTypes.length === siteTypeOptions.length ? "all" : state.siteTypes.join(",");

  try {
    const data = await fetchJson("/api/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        postCodes: state.postCodes,
        counties: state.counties,
        radiusMiles: state.radiusMiles,
        maxSites,
        limitPerType: 2,
        spaceTypes,
        useAi: els.aiInput?.checked ?? true,
        mock: isMockMode()
      })
    });
    state.searches = [data.search, ...state.searches.filter((search) => search.id !== data.search.id)];
    if (data.search.status === "error") {
      alert(data.search.error || "Search failed");
    } else {
      openSearch(data.search.id);
    }
  } catch (error) {
    alert(errorMessage(error));
  } finally {
    els.runSearchButton.disabled = false;
    els.runSearchButton.textContent = "Run Search";
    render();
  }
}

function render() {
  renderNavigation();
  renderPickers();
  renderChips();
  renderSearchRows();
  renderLeadRows();
  renderView();
  renderDrawer();
}

function renderNavigation() {
  els.siteSearchNav.classList.toggle("active", state.view === "site-search");
  els.listsNav.classList.toggle("active", state.view === "list");
}

function renderPickers() {
  countyPicker.refresh();
  siteTypePicker.refresh();
}

function renderView() {
  els.siteSearchView.classList.toggle("hidden", state.view !== "site-search");
  els.listView.classList.toggle("hidden", state.view !== "list");
}

function renderChips() {
  renderChipSet(els.postCodeChips, state.postCodes, "postCodes");
  renderChipSet(els.countyChips, state.counties, "counties");
  renderSiteTypeChips();
  els.radiusChips.replaceChildren();
  if (state.radiusMiles) {
    els.radiusChips.append(chip(`${state.radiusMiles} Miles`, () => {
      state.radiusMiles = undefined;
      els.radiusInput.value = "";
      renderChips();
    }));
  }
}

function renderSiteTypeChips() {
  if (state.siteTypes.length === siteTypeOptions.length) {
    els.siteTypeChips.replaceChildren(summaryChip(`All ${siteTypeOptions.length} Site Types`));
    return;
  }

  const selected = new Set(state.siteTypes);
  els.siteTypeChips.replaceChildren(
    ...siteTypeOptions
      .filter((type) => selected.has(type.value))
      .map((type) =>
        chip(type.label, () => {
          state.siteTypes = state.siteTypes.filter((item) => item !== type.value);
          renderPickers();
          renderChips();
        })
      )
  );
}

function renderChipSet(container, values, key) {
  container.replaceChildren(...values.map((value) => chip(value, () => removeChip(key, value))));
}

function renderSearchRows() {
  const rows = sortedSearches(filteredSearches()).map(searchRow);
  els.searchRows.replaceChildren(...rows);
}

function renderLeadRows() {
  const search = selectedSearch();
  if (!search) {
    els.leadRows.replaceChildren();
    state.selectedLeadIds.clear();
    renderBulkSelection([]);
    return;
  }

  els.listTitle.textContent = `${listName(search)} (${search.summary?.totals.sites || 0})`;
  const allLeads = search.summary?.leads || [];
  const allLeadIds = new Set(allLeads.map((lead) => lead.id));
  for (const selectedId of [...state.selectedLeadIds]) {
    if (!allLeadIds.has(selectedId)) state.selectedLeadIds.delete(selectedId);
  }

  const visibleLeads = sortedLeads(filteredLeads(allLeads));
  els.leadRows.replaceChildren(...visibleLeads.map(leadRow));
  renderBulkSelection(visibleLeads);
}

function searchRow(search) {
  const row = document.createElement("tr");
  row.addEventListener("click", () => openSearch(search.id));

  const metrics = searchMetrics(search);
  row.append(
    textCell(search.name, "strong"),
    cell(statusPill(search.status)),
    cell(chipCluster(search.postCodes, search.counties)),
    textCell(String(metrics.sites), "num"),
    textCell(String(metrics.identified), "num"),
    textCell(String(metrics.contacted), "num"),
    textCell(String(metrics.closedWon), "num"),
    textCell(money(metrics.biffen), "num")
  );
  return row;
}

function leadRow(lead) {
  const row = document.createElement("tr");
  row.classList.toggle("selected", state.selectedLeadIds.has(lead.id));
  row.addEventListener("click", () => openDrawer(lead.id));

  row.append(
    cell(rowCheckbox(lead)),
    cell(siteCell(lead)),
    cell(statusPill(lead.review?.status || "identified")),
    textCell(lead.contact?.emailAddress || "", "truncate"),
    textCell(lead.contact?.phoneNumber || "", "truncate"),
    textCell(lead.site.spaceType, "truncate"),
    textCell(`${lead.analysis.score.total}%`, "num"),
    textCell(money(lead.analysis.totalRevenueYear), "num"),
    textCell(money(lead.analysis.paidToSpaceOwnerYear), "num"),
    textCell(money(lead.analysis.biffenRevenueYear), "num")
  );
  return row;
}

function rowCheckbox(lead) {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "row-checkbox";
  checkbox.checked = state.selectedLeadIds.has(lead.id);
  checkbox.setAttribute("aria-label", `Select ${lead.site.name}`);
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedLeadIds.add(lead.id);
    else state.selectedLeadIds.delete(lead.id);
    renderLeadRows();
  });
  return checkbox;
}

function siteCell(lead) {
  const wrap = document.createElement("div");
  wrap.className = "site-cell";
  const name = document.createElement("strong");
  name.textContent = lead.site.name;
  wrap.append(name);
  if (lead.site.googleMapsUri) {
    const anchor = link(lead.site.googleMapsUri, "↗");
    anchor.addEventListener("click", (event) => event.stopPropagation());
    wrap.append(anchor);
  }
  return wrap;
}

function chipCluster(postCodes, counties) {
  const wrap = document.createElement("div");
  const items = [...(postCodes || []), ...(counties || [])];
  for (const item of items.slice(0, 2)) {
    const span = document.createElement("span");
    span.className = "mini-chip";
    span.textContent = item;
    wrap.append(span);
  }
  if (items.length > 2) {
    const more = document.createElement("span");
    more.className = "mini-chip";
    more.textContent = `+${items.length - 2} More`;
    wrap.append(more);
  }
  return wrap;
}

function statusPill(status) {
  const span = document.createElement("span");
  span.className = `status-pill status-${status}`;
  span.textContent = statusLabel(status);
  return span;
}

function openSearch(id) {
  state.selectedSearchId = id;
  state.view = "list";
  state.selectedLeadId = null;
  state.selectedLeadIds.clear();
  closeDrawer();
  render();
}

function showSearchView() {
  state.view = "site-search";
  state.selectedLeadId = null;
  state.selectedLeadIds.clear();
  closeDrawer();
  render();
}

async function updateReview(leadId, patch) {
  await patchLeadReview(leadId, patch);
  render();
}

async function patchLeadReview(leadId, patch) {
  const data = await fetchJson(`/api/leads/${leadId}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  const lead = selectedSearch()?.summary?.leads.find((item) => item.id === leadId);
  if (lead) lead.review = data.review;
  return data.review;
}

async function bulkUpdateStatus() {
  const selectedIds = [...state.selectedLeadIds];
  if (!selectedIds.length) return;

  els.bulkUpdateStatus.disabled = true;
  els.bulkUpdateStatus.textContent = "Updating";
  try {
    await Promise.all(selectedIds.map((leadId) => patchLeadReview(leadId, { status: els.bulkStatus.value })));
    state.selectedLeadIds.clear();
    render();
  } finally {
    els.bulkUpdateStatus.disabled = false;
    els.bulkUpdateStatus.textContent = "Update Status";
  }
}

async function addMoreSites() {
  const search = selectedSearch();
  if (!search) return;

  const raw = window.prompt("How many more sites do you need?", "10");
  if (raw === null) return;
  const count = Number(raw);
  if (!Number.isFinite(count) || count < 1) {
    alert("Enter a positive number.");
    return;
  }

  const beforeCount = search.summary?.leads?.length ?? 0;
  els.addMoreButton.disabled = true;
  els.addMoreButton.textContent = "Adding";
  try {
    const data = await fetchJson(`/api/searches/${search.id}/add-more`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        count,
        useAi: els.aiInput?.checked ?? true,
        mock: isMockMode()
      })
    });

    const nextSearch = data.search;
    state.searches = [nextSearch, ...state.searches.filter((item) => item.id !== nextSearch.id)];
    state.selectedSearchId = nextSearch.id;
    const afterCount = nextSearch.summary?.leads?.length ?? 0;
    if (afterCount === beforeCount) {
      alert(nextSearch.error || "No new non-duplicate sites found.");
    }
    render();
  } catch (error) {
    alert(errorMessage(error));
  } finally {
    els.addMoreButton.disabled = false;
    els.addMoreButton.textContent = "+ Add More";
  }
}

function renderBulkSelection(visibleLeads = sortedLeads(filteredLeads(selectedSearch()?.summary?.leads || []))) {
  const visibleIds = visibleLeads.map((lead) => lead.id);
  const selectedVisibleCount = visibleIds.filter((id) => state.selectedLeadIds.has(id)).length;
  const selectedCount = state.selectedLeadIds.size;

  els.bulkActions.hidden = selectedCount === 0;
  els.bulkCount.textContent = `${selectedCount} selected`;
  els.leadSelectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  els.leadSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
}

function openDrawer(leadId) {
  state.selectedLeadId = leadId;
  els.drawer.classList.add("open");
  els.scrim.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  renderDrawer();
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.scrim.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
}

function renderDrawer() {
  const lead = selectedLead();
  if (!lead) return;

  els.drawerTitle.textContent = lead.site.name;
  els.drawerStatus.value = lead.review?.status || "identified";
  els.drawerGood.classList.toggle("active", lead.review?.isGood === true);
  els.drawerBad.classList.toggle("active", lead.review?.isGood === false);
  els.feedbackNotes.value = lead.review?.notes || "";
  els.siteImage.src =
    state.imageTab === "original"
      ? lead.snapshots?.originalUrl || ""
      : lead.snapshots?.annotatedUrl || lead.snapshots?.originalUrl || "";

  els.contactDetails.replaceChildren(...contactRows(lead));
  els.aiScoring.textContent = aiScoringText(lead);
}

function contactRows(lead) {
  const phone = lead.contact?.phoneNumber;
  const email = lead.contact?.emailAddress;
  const form = lead.contact?.contactFormUrl;

  return [
    contactLine("Phone", phone ? link(`tel:${phone}`, phone) : "-"),
    contactLine("E-Mail", email ? mailLink(email) : "-"),
    contactLine("Contact Form", form ? link(form, "Contact Form") : "-")
  ];
}

function contactLine(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong);
  if (value instanceof Node) row.append(value);
  else row.append(document.createTextNode(value));
  return row;
}

function aiScoringText(lead) {
  const rationale = lead.analysis.score.rationale?.[0] || lead.analysis.notes?.[0] || "No additional scoring notes.";
  return `AI Scoring: ${lead.analysis.score.total}/100 - ${rationale}`;
}

function downloadSelectedCsv() {
  const search = selectedSearch();
  if (!search?.summary) return;
  const rows = [
    ["Site Name", "Status", "E-Mail", "Phone Number", "Site Type", "Site Viability", "Est. Rev", "Site Owner Rev", "Biff Rev"],
    ...search.summary.leads.map((lead) => [
      lead.site.name,
      statusLabel(lead.review?.status || "identified"),
      lead.contact?.emailAddress || "",
      lead.contact?.phoneNumber || "",
      lead.site.spaceType,
      `${lead.analysis.score.total}%`,
      lead.analysis.totalRevenueYear,
      lead.analysis.paidToSpaceOwnerYear,
      lead.analysis.biffenRevenueYear
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug(search.name)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function filteredSearches() {
  const needle = state.searchFilter.trim().toLowerCase();
  if (!needle) return state.searches;
  return state.searches.filter((search) =>
    [search.name, search.status, ...(search.postCodes || []), ...(search.counties || [])].join(" ").toLowerCase().includes(needle)
  );
}

function filteredLeads(leads) {
  const needle = state.leadFilter.trim().toLowerCase();
  if (!needle) return leads;
  return leads.filter((lead) =>
    [
      lead.site.name,
      lead.site.address,
      lead.site.spaceType,
      lead.contact?.emailAddress,
      lead.contact?.phoneNumber,
      statusLabel(lead.review?.status || "identified")
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

function sortedSearches(searches) {
  return [...searches].sort((a, b) => {
    const av = searchSortValue(a);
    const bv = searchSortValue(b);
    const result = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return state.searchSortDir === "asc" ? result : -result;
  });
}

function sortedLeads(leads) {
  return [...leads].sort((a, b) => {
    const av = leadSortValue(a);
    const bv = leadSortValue(b);
    const result = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    return state.leadSortDir === "asc" ? result : -result;
  });
}

function searchSortValue(search) {
  const metrics = searchMetrics(search);
  if (state.searchSort === "name") return search.name;
  if (state.searchSort === "status") return search.status;
  if (state.searchSort === "sites") return metrics.sites;
  if (state.searchSort === "identified") return metrics.identified;
  if (state.searchSort === "contacted") return metrics.contacted;
  if (state.searchSort === "closed") return metrics.closedWon;
  if (state.searchSort === "biffen") return metrics.biffen;
  return new Date(search.createdAt).getTime();
}

function leadSortValue(lead) {
  if (state.leadSort === "site") return lead.site.name;
  if (state.leadSort === "status") return lead.review?.status || "identified";
  if (state.leadSort === "email") return lead.contact?.emailAddress || "";
  if (state.leadSort === "phone") return lead.contact?.phoneNumber || "";
  if (state.leadSort === "type") return lead.site.spaceType;
  if (state.leadSort === "viability") return lead.analysis.score.total;
  if (state.leadSort === "revenue") return lead.analysis.totalRevenueYear;
  if (state.leadSort === "owner") return lead.analysis.paidToSpaceOwnerYear;
  if (state.leadSort === "biff") return lead.analysis.biffenRevenueYear;
  return 0;
}

function setSort(kind, key) {
  const sortKey = `${kind}Sort`;
  const dirKey = `${kind}SortDir`;
  if (state[sortKey] === key) {
    state[dirKey] = state[dirKey] === "asc" ? "desc" : "asc";
  } else {
    state[sortKey] = key;
    state[dirKey] = key === "site" || key === "name" ? "asc" : "desc";
  }
  render();
}

function searchMetrics(search) {
  const leads = search.summary?.leads || [];
  return {
    sites: leads.length,
    identified: leads.filter((lead) => (lead.review?.status || "identified") === "identified").length,
    contacted: leads.filter((lead) => (lead.review?.status || "identified") === "contacted").length,
    closedWon: leads.filter((lead) => (lead.review?.status || "identified") === "closed_won").length,
    biffen: search.summary?.totals.biffenRevenueYear || 0
  };
}

function selectedSearch() {
  return state.searches.find((search) => search.id === state.selectedSearchId);
}

function selectedLead() {
  return selectedSearch()?.summary?.leads.find((lead) => lead.id === state.selectedLeadId);
}

function addChip(key, rawValue) {
  const value = rawValue.trim();
  if (!value || state[key].includes(value)) return;
  state[key].push(value);
  renderChips();
}

function removeChip(key, value) {
  state[key] = state[key].filter((item) => item !== value);
  renderPickers();
  renderChips();
}

function setRadiusFromInput() {
  const value = Number(els.radiusInput.value);
  if (Number.isFinite(value) && value > 0) {
    state.radiusMiles = value;
  } else if (!els.radiusInput.value.trim()) {
    state.radiusMiles = undefined;
  }
  renderChips();
}

function chip(label, onRemove) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = label;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "×";
  button.addEventListener("click", onRemove);
  span.append(button);
  return span;
}

function summaryChip(label) {
  const span = document.createElement("span");
  span.className = "chip summary-chip";
  span.textContent = label;
  return span;
}

function createMultiPicker({
  root,
  options,
  emptyLabel,
  allLabel,
  searchPlaceholder,
  showSelectAll,
  getSelected,
  setSelected
}) {
  let isOpen = false;
  let searchValue = "";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "multi-trigger";

  const triggerText = document.createElement("span");
  triggerText.className = "multi-trigger-text";
  const triggerIcon = document.createElement("span");
  triggerIcon.className = "multi-trigger-icon";
  triggerIcon.textContent = "⌄";
  trigger.append(triggerText, triggerIcon);

  const menu = document.createElement("div");
  menu.className = "multi-menu";

  const searchWrap = document.createElement("label");
  searchWrap.className = "multi-search";
  const searchIcon = document.createElement("span");
  searchIcon.textContent = "⌕";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = searchPlaceholder;
  searchWrap.append(searchIcon, searchInput);

  const list = document.createElement("div");
  list.className = "multi-list";

  const actions = document.createElement("div");
  actions.className = "multi-actions";
  if (showSelectAll) {
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.textContent = "All";
    allButton.addEventListener("click", () => setSelected(options.map((option) => option.value)));
    actions.append(allButton);
  }
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.addEventListener("click", () => setSelected([]));
  actions.append(clearButton);

  menu.append(searchWrap, list, actions);
  root.replaceChildren(trigger, menu);

  trigger.addEventListener("click", () => {
    isOpen = !isOpen;
    refresh();
    if (isOpen) queueMicrotask(() => searchInput.focus());
  });

  searchInput.addEventListener("input", () => {
    searchValue = searchInput.value;
    renderOptions();
  });

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) {
      isOpen = false;
      refresh();
    }
  });

  function refresh() {
    const selected = getSelected();
    root.classList.toggle("open", isOpen);
    triggerText.textContent = selectedLabel(selected, options, emptyLabel, allLabel);
    renderOptions();
  }

  function renderOptions() {
    const needle = searchValue.trim().toLowerCase();
    const selected = new Set(getSelected());
    const visibleOptions = options.filter(
      (option) => !needle || option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)
    );

    list.replaceChildren(
      ...visibleOptions.map((option) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "multi-option";
        row.classList.toggle("selected", selected.has(option.value));

        const label = document.createElement("span");
        label.textContent = option.label;
        const check = document.createElement("span");
        check.className = "multi-check";
        check.textContent = "✓";

        row.append(label, check);
        row.addEventListener("click", () => {
          const next = new Set(getSelected());
          if (next.has(option.value)) next.delete(option.value);
          else next.add(option.value);
          setSelected(options.filter((item) => next.has(item.value)).map((item) => item.value));
        });
        return row;
      })
    );
  }

  refresh();
  return { refresh };
}

function selectedLabel(selected, options, emptyLabel, allLabel) {
  if (!selected.length) return emptyLabel;
  if (selected.length === options.length) return allLabel;
  if (selected.length === 1) {
    return options.find((option) => option.value === selected[0])?.label || selected[0];
  }
  return `${selected.length} selected`;
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function textCell(text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function link(href, text) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = text;
  return anchor;
}

function mailLink(email) {
  return link(`mailto:${email}`, email);
}

function definitionList(rows) {
  return rows.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value || "-";
    return [dt, dd];
  });
}

function statusLabel(status) {
  const found = statusOptions.find(([value]) => value === status);
  if (found) return found[1];
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "error") return "Error";
  return status;
}

function listName(search) {
  const firstPostCode = search.postCodes?.[0];
  return firstPostCode ? `${firstPostCode} Sites` : `${search.name} Sites`;
}

function defaultSearchName() {
  return state.postCodes[0] ? `${state.postCodes[0]} Sites` : "Site Search";
}

function isMockMode() {
  return new URLSearchParams(window.location.search).get("mock") === "1" || Boolean(els.mockInput?.checked);
}

function money(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sites";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.trim().slice(0, 160) || response.statusText || "Empty response";
    throw new Error(`Server returned ${response.status}: ${snippet}`);
  }

  if (!response.ok) {
    throw new Error(responseErrorMessage(data, response));
  }

  return data;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return responseErrorMessage({ error }, { status: "unknown", statusText: "" });
}

function responseErrorMessage(data, response) {
  const raw = data?.error ?? data?.message ?? data;
  if (typeof raw === "string") return raw;

  if (raw && typeof raw === "object") {
    const message = raw.message || raw.error || raw.reason || raw.code;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(raw);
    } catch {
      return `Request failed with ${response.status}`;
    }
  }

  return response?.statusText || `Request failed with ${response.status}`;
}

function titleCase(value) {
  return value.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (word) => {
    const upper = word.toUpperCase();
    if (["DIY", "MOT", "NHS"].includes(upper)) return upper;
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
  });
}
