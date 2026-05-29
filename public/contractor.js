const token = new URLSearchParams(window.location.search).get("token");
const rows = document.querySelector("#contractorRows");
const projectName = document.querySelector("#projectName");
const detail = document.querySelector("#contractorDetail");
const siteName = document.querySelector("#contractorSiteName");
const detailList = document.querySelector("#contractorDetails");
const mediaLinks = document.querySelector("#contractorMedia");
const mapFrame = document.querySelector("#contractorMap");
const streetFrame = document.querySelector("#contractorStreet");
const mapOpen = document.querySelector("#contractorMapOpen");
const streetOpen = document.querySelector("#contractorStreetOpen");
const interested = document.querySelector("#markInterested");
const rejected = document.querySelector("#markRejected");
const message = document.querySelector("#contractorMessage");
let project;
let selectedLeadId;

if (!token) {
  message.textContent = "This contractor project link is missing its token.";
} else {
  loadProject();
}

interested.addEventListener("click", () => updateStatus("interested"));
rejected.addEventListener("click", () => updateStatus("rejected"));

async function loadProject() {
  try {
    const data = await fetchJson(`/api/contractor/${encodeURIComponent(token)}`);
    project = data.project;
    projectName.textContent = project.name;
    renderRows();
  } catch (error) {
    message.textContent = errorMessage(error);
  }
}

function renderRows() {
  rows.replaceChildren(
    ...(project.siteProfiles || []).map((site) => {
      const row = document.createElement("tr");
      row.addEventListener("click", () => openSite(site.leadId));
      row.append(
        textCell(site.lead?.site.name || site.leadId),
        textCell(site.postcode || ""),
        textCell(distanceLabel(site.distanceMiles ?? site.lead?.site.distanceMiles)),
        textCell(statusLabel(site.contractorStatus))
      );
      return row;
    })
  );
}

function openSite(leadId) {
  selectedLeadId = leadId;
  const site = project.siteProfiles.find((item) => item.leadId === leadId);
  if (!site?.lead) return;
  const lead = site.lead;
  const details = lead.profile?.siteDetails || {};
  detail.classList.remove("hidden");
  siteName.textContent = lead.site.name;
  mapFrame.src = mapEmbedUrl(lead);
  streetFrame.src = streetViewEmbedUrl(lead);
  mapOpen.href = lead.site.googleMapsUri || mapOpenUrl(lead);
  streetOpen.href = streetViewOpenUrl(lead);
  detailList.replaceChildren(
    ...definitionList([
      ["24/7 Access / Schedule", details.accessSchedule],
      ["Gated or Ungated", details.gatedExternal],
      ["CCTV On-Site", boolLabel(details.cctvOnSite)],
      ["Additional Site Notes", details.additionalSiteNotes],
      ["Distance from Postcode", distanceLabel(site.distanceMiles ?? lead.site.distanceMiles)],
      ["Estimated Drive Time", details.estimatedDriveMinutes ? `${details.estimatedDriveMinutes} mins` : ""],
      ["Rough Locker Placement", details.roughLockerPlacement]
    ])
  );
  mediaLinks.replaceChildren(...(details.mediaUrls || []).map((url) => link(url, url)));
}

async function updateStatus(status) {
  if (!selectedLeadId) return;
  try {
    const data = await fetchJson(`/api/contractor/${encodeURIComponent(token)}/sites/${selectedLeadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    project = data.project;
    renderRows();
    message.textContent = status === "interested" ? "Marked interested." : "Marked rejected.";
  } catch (error) {
    message.textContent = errorMessage(error);
  }
}

function mapEmbedUrl(lead) {
  const location = lead.site.location;
  if (!location) return "about:blank";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}&z=19&t=k&output=embed`;
}

function streetViewEmbedUrl(lead) {
  const location = lead.site.location;
  if (!location) return "about:blank";
  return `https://www.google.com/maps?layer=c&cbll=${location.latitude},${location.longitude}&cbp=12,0,0,0,0&output=svembed`;
}

function mapOpenUrl(lead) {
  const location = lead.site.location;
  if (!location) return "https://www.google.com/maps";
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

function streetViewOpenUrl(lead) {
  const location = lead.site.location;
  if (!location) return lead.site.googleMapsUri || "https://www.google.com/maps";
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${location.latitude},${location.longitude}`;
}

function definitionList(items) {
  return items.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "-";
    return [dt, dd];
  });
}

function textCell(text) {
  const td = document.createElement("td");
  td.textContent = text || "";
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

function boolLabel(value) {
  if (value === true) return "True";
  if (value === false) return "False";
  return "";
}

function statusLabel(value) {
  if (value === "interested") return "Interested";
  if (value === "rejected") return "Rejected";
  return "For Review";
}

function distanceLabel(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} miles` : "";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error || response.statusText || "Request failed");
  return data;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
