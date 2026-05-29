const token = new URLSearchParams(window.location.search).get("token");
const fields = document.querySelectorAll("[data-profile-field]");
const title = document.querySelector("#ownerTitle");
const saveButton = document.querySelector("#ownerSave");
const message = document.querySelector("#ownerMessage");
let lead;

if (!token) {
  message.textContent = "This site owner form link is missing its token.";
  saveButton.disabled = true;
} else {
  loadOwnerForm();
}

saveButton.addEventListener("click", saveOwnerForm);

async function loadOwnerForm() {
  try {
    const data = await fetchJson(`/api/owner/${encodeURIComponent(token)}`);
    lead = data.lead;
    title.textContent = lead.site?.name || "Site Profile";
    populateFields(lead);
  } catch (error) {
    message.textContent = errorMessage(error);
    saveButton.disabled = true;
  }
}

async function saveOwnerForm() {
  saveButton.disabled = true;
  saveButton.textContent = "Saving";
  message.textContent = "";
  try {
    const data = await fetchJson(`/api/owner/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPatch())
    });
    lead = data.lead;
    populateFields(lead);
    message.textContent = "Saved. Thank you.";
  } catch (error) {
    message.textContent = errorMessage(error);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Details";
  }
}

function populateFields(currentLead) {
  for (const field of fields) {
    const value = fieldValue(currentLead, field.dataset.profileField);
    if (field.dataset.valueType === "lines") {
      field.value = Array.isArray(value) ? value.join("\n") : value || "";
      continue;
    }
    if (field.dataset.valueType === "boolean") {
      field.value = value === true ? "true" : value === false ? "false" : "";
      continue;
    }
    field.value = value ?? "";
  }
}

function fieldValue(currentLead, path) {
  const stored = nestedValue(currentLead.profile, path);
  if (stored !== undefined && stored !== null) return stored;

  const fallbacks = {
    "profile.siteName": currentLead.site?.name,
    "profile.siteWebsite": currentLead.site?.websiteUri,
    "profile.siteContactEmail": currentLead.contact?.emailAddress,
    "profile.sitePhoneNumber": currentLead.contact?.phoneNumber,
    "profile.siteAddress": currentLead.site?.address,
    "profile.contactForm": currentLead.contact?.contactFormUrl
  };
  return fallbacks[path];
}

function collectPatch() {
  const patch = { profile: {}, business: {}, siteDetails: {} };
  for (const field of fields) {
    const [section, key] = field.dataset.profileField.split(".");
    let value = field.value.trim();
    if (field.dataset.valueType === "boolean") {
      value = value === "true" ? true : value === "false" ? false : undefined;
    } else if (field.dataset.valueType === "lines") {
      value = value
        ? value
            .split(/\n|,/)
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined;
    } else if (!value) {
      value = undefined;
    }
    patch[section][key] = value;
  }
  return patch;
}

function nestedValue(source, path) {
  return path.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), source);
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
