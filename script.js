"use strict";

const CATEGORIES = ["ID Card", "Electronics", "Books", "Accessories", "Other"];
const STATUSES = ["Lost", "Found", "Returned"];
const categoryIcons = {
  "ID Card": "contact",
  Electronics: "headphones",
  Books: "book-open",
  Accessories: "key-round",
  Other: "package",
};
function dateOffset(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validItem(item) {
  return (
    item &&
    typeof item.id === "string" &&
    ["name", "description", "date", "location", "contact"].every(
      (field) => typeof item[field] === "string",
    ) &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    !Number.isNaN(new Date(item.date).getTime()) &&
    CATEGORIES.includes(item.category) &&
    STATUSES.includes(item.status) &&
    ["Lost", "Found"].includes(item.originalStatus) &&
    Number.isFinite(item.createdAt)
  );
}

let items = [];
let browseItems = [];
let statistics = { total: 0, found: 0, returned: 0 };
let databaseReady = false;
let connectionError = "";
let requestVersion = 0;
let searchTimer;
let submitting = false;
let homeStatus = "all";
let reportType = "Lost";
let activeItemId = null;
let toastTimer;
const dialog = document.getElementById("detail-dialog");
const reportForm = document.getElementById("report-form");

function icon(name, extra = "") {
  const element = document.createElement("span");
  element.className = `icon icon-${name} ${extra}`.trim();
  element.setAttribute("aria-hidden", "true");
  return element;
}
document.querySelectorAll("[data-icon]").forEach((element) => {
  element.classList.add("icon", `icon-${element.dataset.icon}`);
  element.setAttribute("aria-hidden", "true");
});

function notify(message) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 5500);
}

async function apiRequest(endpoint, options = {}) {
  if (location.protocol === "file:") {
    throw new Error("Open FindIt through the C server at http://127.0.0.1:8080, not as a file. Start it with .\\start.ps1.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, { ...options, cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The database request failed.");
    return data;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw new Error("Cannot reach the C server. Start .\\start.ps1, then retry the connection.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Request versions prevent an older search response from replacing newer results.
async function reloadItems() {
  const version = ++requestVersion;
  const filters = new URLSearchParams({
    q: document.getElementById("browse-query").value.trim(),
    category: document.getElementById("category-filter").value,
    status: document.getElementById("status-filter").value,
  });
  document.getElementById("results-count").textContent = "Loading reports...";
  try {
    const [all, matching, totals] = await Promise.all([
      apiRequest("/api/items"),
      apiRequest(`/api/items?${filters}`),
      apiRequest("/api/stats"),
    ]);
    if (version !== requestVersion) return false;
    if (!Array.isArray(all) || !all.every(validItem) || !Array.isArray(matching) || !matching.every(validItem) || !["total", "found", "returned"].every((field) => Number.isFinite(totals[field]))) {
      throw new Error("The server returned invalid report data. Please retry.");
    }
    items = all;
    browseItems = matching;
    statistics = totals;
    databaseReady = true;
    connectionError = "";
  } catch (error) {
    if (version !== requestVersion) return false;
    databaseReady = false;
    connectionError = error.message;
  }
  const notice = document.getElementById("connection-notice");
  notice.hidden = !connectionError;
  document.getElementById("connection-message").textContent = connectionError;
  document.getElementById("local-server-link").hidden = location.protocol !== "file:";
  reportForm.querySelector('[type="submit"]').disabled = !databaseReady || submitting;
  render();
  return databaseReady;
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function badge(status) {
  const element = document.createElement("span");
  element.className = `badge ${status.toLowerCase()}`;
  element.textContent = status;
  return element;
}
function safeImage(source) {
  if (typeof source !== "string") return "";
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source))
    return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" &&
      parsed.hostname === "images.unsplash.com"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}
function itemVisual(item, detail = false) {
  const container = document.createElement("div");
  container.className = detail ? "detail-placeholder" : "item-visual";
  const source = safeImage(item.image);
  if (source) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = item.demo
      ? `${item.category} reference photo for demonstration`
      : item.name;
    image.loading = "lazy";
    if (detail) {
      image.className = "detail-image";
      container.className = "";
    }
    image.addEventListener(
      "error",
      () => {
        image.remove();
        container.className = detail ? "detail-placeholder" : "item-visual";
        container.prepend(
          icon(categoryIcons[item.category], "placeholder-icon"),
        );
      },
      { once: true },
    );
    container.append(image);
  } else
    container.append(icon(categoryIcons[item.category], "placeholder-icon"));
  if (!detail) {
    container.append(badge(item.status));
    if (item.demo) {
      const demo = document.createElement("span");
      demo.className = "demo-tag";
      demo.textContent = "Demo report";
      container.append(demo);
    }
  }
  return container;
}
function metaRow(iconName, text) {
  const row = document.createElement("div");
  row.className = "item-meta";
  const label = document.createElement("span");
  label.textContent = text;
  row.append(icon(iconName), label);
  return row;
}
function createCard(item) {
  const article = document.createElement("article");
  article.className = "item-card";
  const body = document.createElement("div");
  body.className = "item-body";
  const category = document.createElement("span");
  category.className = "item-category";
  category.textContent = item.category;
  const title = document.createElement("h3");
  title.textContent = item.name;
  const bottom = document.createElement("div");
  bottom.className = "card-bottom";
  const posted = document.createElement("span");
  posted.textContent = item.demo ? "Campus community" : "Campus report";
  const button = document.createElement("button");
  button.className = "detail-button";
  button.textContent = "View Details";
  button.setAttribute("aria-label", `View details for ${item.name}`);
  button.append(icon("arrow-up-right"));
  button.addEventListener("click", () => showDetails(item.id));
  bottom.append(posted, button);
  body.append(
    category,
    title,
    metaRow("map-pin", item.location),
    metaRow("calendar-days", formatDate(item.date)),
    bottom,
  );
  article.append(itemVisual(item), body);
  return article;
}
function renderCards(containerId, records) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  if (records.length) container.append(...records.map(createCard));
  else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("h3");
    title.textContent = databaseReady ? "No matches just yet." : connectionError ? "Noticeboard unavailable." : "Connecting to the noticeboard...";
    const message = document.createElement("p");
    message.textContent = databaseReady ? "Try a different search or category, or share a report with the campus." : "Reports will appear when the C database server is connected.";
    const link = document.createElement("a");
    link.className = "button primary";
    link.href = "#lost";
    link.textContent = "Report a lost item";
    empty.append(icon("search-x"), title, message, link);
    container.append(empty);
  }
}
function render() {
  const ordered = [...items].sort(
    (first, second) => second.createdAt - first.createdAt,
  );
  renderCards(
    "recent-items",
    (databaseReady ? ordered : [])
      .filter((item) => homeStatus === "all" || item.status === homeStatus)
      .slice(0, 4),
  );
  renderCards("browse-items", databaseReady ? browseItems : []);
  document.getElementById("results-count").textContent =
    databaseReady ? `${browseItems.length} ${browseItems.length === 1 ? "item" : "items"} on the noticeboard` : "Database not connected";
  for (const field of ["total", "found", "returned"]) {
    document.querySelector(`[data-stat="${field}"]`).textContent = databaseReady ? statistics[field] : "...";
  }
}
function route() {
  const requested = location.hash.slice(1) || "home";
  if (requested === "main") {
    document.getElementById("main").focus();
    render();
    return;
  }
  const page = ["home", "browse", "lost", "found", "about"].includes(requested)
    ? requested
    : "home";
  const view = page === "lost" || page === "found" ? "report" : page;
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.id !== `${view}-view`;
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === page);
    if (link.dataset.nav === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("navigation").classList.remove("open");
  document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
  document
    .getElementById("menu-toggle")
    .setAttribute("aria-label", "Open navigation");
  if (view === "report") {
    const nextType = page === "found" ? "Found" : "Lost";
    if (nextType !== reportType) {
      reportForm.reset();
      document.getElementById("form-error").textContent = "";
    }
    reportType = nextType;
    document.getElementById("report-title").textContent =
      reportType === "Lost"
        ? "Lost something? Start here."
        : "Found something? Make a day.";
    document.getElementById("report-subtitle").textContent =
      reportType === "Lost"
        ? "Tell us what went missing. A few good details can help the right person find you."
        : "Share a few details and help someone's belongings find their way home.";
    document.getElementById("date-label").textContent =
      `Date ${reportType.toLowerCase()} *`;
    document.getElementById("location-label").textContent =
      reportType === "Lost" ? "Last seen location *" : "Location found *";
    document.getElementById("image-field").hidden = reportType !== "Found";
    document
      .getElementById("lost-tab")
      .classList.toggle("active", reportType === "Lost");
    document
      .getElementById("found-tab")
      .classList.toggle("active", reportType === "Found");
    reportForm.elements.date.max = dateOffset();
  }
  if (dialog.open) dialog.close();
  const titles = {
    home: "Your Campus Lost & Found",
    browse: "Browse Items",
    lost: "Report Lost Item",
    found: "Report Found Item",
    about: "How It Works",
  };
  document.title = `FindIt | ${titles[page]}`;
  render();
  if (databaseReady) void reloadItems();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function showDetails(id) {
  const item = items.find((record) => record.id === id);
  if (!item) return;
  activeItemId = id;
  const content = document.getElementById("detail-content");
  content.replaceChildren(itemVisual(item, true));
  const info = document.createElement("div");
  info.className = "detail-info";
  const title = document.createElement("h2");
  title.id = "detail-title";
  title.textContent = item.name;
  const description = document.createElement("p");
  description.className = "detail-description";
  description.textContent = item.description;
  const details = document.createElement("dl");
  for (const [label, value] of [
    ["Category", item.category],
    ["Location", item.location],
    ["Date", formatDate(item.date)],
    ["Contact", item.contact],
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    if (
      label === "Contact" &&
      !item.demo &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      const contact = document.createElement("a");
      contact.href = `mailto:${encodeURIComponent(value)}`;
      contact.textContent = value;
      definition.replaceChildren(contact);
    }
    details.append(term, definition);
  }
  const notice = document.createElement("p");
  notice.className = "detail-notice";
  notice.textContent =
    "Verify ownership privately. Arrange a handover at a public campus location or through campus security.";
  info.append(badge(item.status), title, description, details, notice);
  if (item.status !== "Returned") {
    const button = document.createElement("button");
    button.className = "button primary";
    button.id = "mark-returned";
    button.append(
      icon("circle-check"),
      document.createTextNode("Mark as returned"),
    );
    button.addEventListener("click", async () => {
      const current = items.find((record) => record.id === activeItemId);
      if (
        !current ||
        !confirm(
          `Confirm that "${current.name}" has been reunited with its owner?`,
        )
      )
        return;
      button.disabled = true;
      try {
        await apiRequest(`/api/items/${encodeURIComponent(current.id)}/return`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Returned" }),
        });
        dialog.close();
        const refreshed = await reloadItems();
        notify(refreshed ? "One less thing lost. Returned status saved to the database." : "Returned status was saved. Retry the connection to refresh the noticeboard.");
      } catch (error) {
        notify(`Item was not updated. ${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
    info.append(button);
  } else {
    const returned = document.createElement("p");
    returned.textContent = "Reunited with its owner. This report is closed.";
    info.append(returned);
  }
  if (item.demo) {
    const demo = document.createElement("p");
    demo.className = "detail-demo";
    demo.textContent =
      "Demonstration report. Reference photos and example.com contacts are not real claims.";
    info.append(demo);
  }
  content.append(info);
  dialog.showModal();
}

// Resize uploads to keep database records and HTTP requests small.
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return reject(new Error("Choose a JPG, PNG, or WebP image."));
    if (file.size > 2 * 1024 * 1024)
      return reject(new Error("Please choose a photo smaller than 2 MB."));
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new Error("The photo could not be read. Please try another file."),
      );
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(
          new Error(
            "That image could not be opened. Please choose another photo.",
          ),
        );
      image.onload = () => {
        try {
          const scale = Math.min(1, 900 / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Image processing unavailable");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        } catch {
          reject(
            new Error("Unable to process this photo. Try a smaller image."),
          );
        }
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) return;
  const errorElement = document.getElementById("form-error");
  errorElement.textContent = "";
  if (!reportForm.reportValidity()) return;
  const data = new FormData(reportForm);
  const record = Object.fromEntries(
    ["name", "category", "description", "date", "location", "contact"].map(
      (field) => [field, String(data.get(field)).trim()],
    ),
  );
  if (
    Object.values(record).some((value) => !value) ||
    record.description.length < 10
  ) {
    errorElement.textContent =
      "Complete every required field and add at least 10 characters of description.";
    return;
  }
  if (!CATEGORIES.includes(record.category) || record.date > dateOffset()) {
    errorElement.textContent =
      "Choose a valid category and a date that is not in the future.";
    return;
  }
  const button = reportForm.querySelector('[type="submit"]');
  const submittedType = reportType;
  submitting = true;
  button.disabled = true;
  document.getElementById("submit-label").textContent = "Saving report...";
  try {
    const file = reportForm.elements.image.files[0];
    const image =
      submittedType === "Found" && file ? await prepareImage(file) : "";
    await apiRequest("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...record, status: submittedType, image }),
    });
    reportForm.reset();
    document.getElementById("browse-query").value = "";
    document.getElementById("category-filter").value = "all";
    document.getElementById("status-filter").value = "all";
    const refreshed = await reloadItems();
    location.hash = "browse";
    notify(refreshed ? "Your report is on the noticeboard. Saved to the SQLite database." : "Your report was saved. Retry the connection to refresh the noticeboard.");
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitting = false;
    button.disabled = !databaseReady;
    document.getElementById("submit-label").textContent = "Submit report";
  }
});
document.getElementById("hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  document.getElementById("browse-query").value =
    document.getElementById("hero-query").value;
  document.getElementById("category-filter").value = "all";
  document.getElementById("status-filter").value = "all";
  location.hash = "browse";
});
document.getElementById("home-status").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  homeStatus = button.dataset.status;
  document.querySelectorAll("#home-status button").forEach((tab) => {
    tab.classList.toggle("selected", tab === button);
    tab.setAttribute("aria-pressed", String(tab === button));
  });
  render();
});
document.getElementById("browse-query").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void reloadItems(), 180);
});
document.getElementById("category-filter").addEventListener("change", () => void reloadItems());
document.getElementById("status-filter").addEventListener("change", () => void reloadItems());
document.getElementById("clear-filters").addEventListener("click", () => {
  document.getElementById("browse-query").value = "";
  document.getElementById("category-filter").value = "all";
  document.getElementById("status-filter").value = "all";
  void reloadItems();
});
document.getElementById("menu-toggle").addEventListener("click", () => {
  const open = document.getElementById("navigation").classList.toggle("open");
  document
    .getElementById("menu-toggle")
    .setAttribute("aria-expanded", String(open));
  document
    .getElementById("menu-toggle")
    .setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});
document
  .getElementById("close-dialog")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
window.addEventListener("hashchange", route);
document.getElementById("retry-connection").addEventListener("click", () => void reloadItems());
window.addEventListener("focus", () => void reloadItems());
document.getElementById("year").textContent = new Date().getFullYear();
reportForm.querySelector('[type="submit"]').disabled = true;
route();
void reloadItems();
