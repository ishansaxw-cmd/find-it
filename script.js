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
let preferences = { category: "all", status: "Found" };
let rewards = { points: 0, reports: 0, returnedIds: [] };
let activeSpeechButton = null;
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
    throw new Error("Run node start-ui.mjs and open http://127.0.0.1:3000. Report data also requires the C server.");
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
      throw new Error("Cannot reach the report server. Start the C server, then retry the connection.");
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

function renderPersonalDashboard() {
  const container = document.getElementById("personal-items");
  const records = [...items]
    .filter(
      (item) =>
        (preferences.category === "all" ||
          item.category === preferences.category) &&
        (preferences.status === "all" || item.status === preferences.status),
    )
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, 4);
  container.replaceChildren();
  if (!databaseReady || records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = databaseReady
      ? "No reports match these choices yet. Try another category or activity type."
      : "Connect to the local noticeboard to see reports tailored to you.";
    container.append(empty);
    return;
  }
  container.append(...records.map(createCard));
}

const COMMON_WORDS = new Set([
  "and", "are", "for", "from", "has", "have", "in", "into", "item",
  "its", "near", "the", "this", "was", "with", "you",
]);

function tokens(value) {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
        (word) => word.length > 2 && !COMMON_WORDS.has(word),
      ),
    ),
  ];
}

function sharedTokens(first, second) {
  const secondWords = new Set(second);
  return first.filter((word) => secondWords.has(word));
}

function findSmartMatches() {
  const lostItems = items.filter((item) => item.status === "Lost");
  const foundItems = items.filter((item) => item.status === "Found");
  const matches = [];
  for (const lost of lostItems) {
    for (const found of foundItems) {
      const sharedDescription = sharedTokens(
        tokens(`${lost.name} ${lost.description}`),
        tokens(`${found.name} ${found.description}`),
      );
      const sharedLocation = sharedTokens(
        tokens(lost.location),
        tokens(found.location),
      );
      if (sharedDescription.length === 0 && sharedLocation.length === 0) continue;
      const score = Math.min(
        100,
        (lost.category === found.category ? 40 : 0) +
          Math.min(sharedDescription.length, 4) * 12 +
          Math.min(sharedLocation.length, 2) * 6,
      );
      if (score >= 24) matches.push({ lost, found, score });
    }
  }
  return matches.sort((first, second) => second.score - first.score).slice(0, 3);
}

function renderSmartMatches() {
  const container = document.getElementById("smart-matches");
  container.replaceChildren();
  if (!databaseReady) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = "Connect to the local noticeboard to look for possible matches.";
    container.append(empty);
    return;
  }
  const matches = findSmartMatches();
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent =
      "No likely pairs yet. New Lost and Found reports may create a match.";
    container.append(empty);
    return;
  }
  for (const match of matches) {
    const card = document.createElement("article");
    card.className = "match-card";
    const score = document.createElement("span");
    score.className = "match-score";
    score.textContent = `Suggestion score: ${match.score}/100`;
    const title = document.createElement("h3");
    title.textContent = "These reports may be related";
    const summary = document.createElement("p");
    summary.className = "match-summary";
    summary.textContent = `${match.lost.name} (Lost) · ${match.found.name} (Found)`;
    const reason = document.createElement("p");
    const reasons = [];
    if (match.lost.category === match.found.category) reasons.push("same category");
    const keywordCount = sharedTokens(
      tokens(`${match.lost.name} ${match.lost.description}`),
      tokens(`${match.found.name} ${match.found.description}`),
    ).length;
    if (keywordCount) reasons.push(`${keywordCount} shared keyword${keywordCount === 1 ? "" : "s"}`);
    const locationCount = sharedTokens(
      tokens(match.lost.location),
      tokens(match.found.location),
    ).length;
    if (locationCount) reasons.push("similar location");
    reason.textContent = reasons.join(" · ");
    const actions = document.createElement("div");
    actions.className = "match-actions";
    for (const [label, item] of [
      ["View Lost report", match.lost],
      ["View Found report", match.found],
    ]) {
      const button = document.createElement("button");
      button.className = "detail-button";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => showDetails(item.id));
      actions.append(button);
    }
    card.append(score, title, summary, reason, actions);
    container.append(card);
  }
}

function renderRewards() {
  document.getElementById("reward-points").textContent = rewards.points;
  const badges = [
    { label: "First report", unlocked: rewards.reports >= 1 },
    { label: "Campus helper", unlocked: rewards.reports >= 3 },
    { label: "Happy reunion", unlocked: rewards.returnedIds.length >= 1 },
    { label: "Community champion", unlocked: rewards.points >= 50 },
  ];
  const list = document.getElementById("badge-list");
  list.replaceChildren(
    ...badges.map((badgeInfo) => {
      const badge = document.createElement("li");
      badge.className = badgeInfo.unlocked ? "unlocked" : "";
      badge.textContent = `${badgeInfo.unlocked ? "★" : "○"} ${badgeInfo.label}`;
      return badge;
    }),
  );
}

function saveFeatureState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

function loadFeatureState() {
  try {
    const saved = localStorage.getItem("findit.preferences.v1");
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (
        !parsed ||
        !["all", ...CATEGORIES].includes(parsed.category) ||
        !["Found", "Lost", "all"].includes(parsed.status)
      ) {
        throw new Error("Saved dashboard choices are invalid.");
      }
      preferences = parsed;
    }
  } catch (error) {
    notify(`Dashboard preferences could not be loaded: ${error.message}`);
  }
  try {
    const saved = localStorage.getItem("findit.rewards.v1");
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (
        !parsed ||
        !Number.isSafeInteger(parsed.points) ||
        parsed.points < 0 ||
        !Number.isSafeInteger(parsed.reports) ||
        parsed.reports < 0 ||
        !Array.isArray(parsed.returnedIds) ||
        !parsed.returnedIds.every((id) => typeof id === "string")
      ) {
        throw new Error("Saved reward data is invalid.");
      }
      rewards = parsed;
    }
  } catch (error) {
    notify(`Demo rewards could not be loaded: ${error.message}`);
  }
  document.getElementById("personal-category").value = preferences.category;
  document.getElementById("personal-status").value = preferences.status;
  renderRewards();
}

function awardContribution(type, itemId = "") {
  if (type === "return" && rewards.returnedIds.includes(itemId)) return true;
  if (type === "report") {
    rewards.reports += 1;
    rewards.points += 10;
  } else {
    rewards.returnedIds.push(itemId);
    rewards.points += 20;
  }
  renderRewards();
  return saveFeatureState("findit.rewards.v1", rewards);
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
  renderPersonalDashboard();
  renderSmartMatches();
  renderRewards();
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
  ]) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    details.append(term, definition);
  }
  const contactTerm = document.createElement("dt");
  contactTerm.textContent = "Contact";
  const contactDefinition = document.createElement("dd");
  const revealNotice = document.createElement("span");
  revealNotice.className = "contact-prompt";
  revealNotice.textContent = "Reveal only if you are comfortable viewing shared contact details.";
  const revealButton = document.createElement("button");
  revealButton.className = "detail-button contact-reveal";
  revealButton.type = "button";
  revealButton.textContent = "Reveal contact";
  revealButton.addEventListener("click", () => {
    if (
      !confirm(
        "Safety reminder: this demo has no accounts, OTP, or access controls. Contact data is available from the local server to anyone who can reach it. Never share sensitive information. Continue?",
      )
    ) {
      return;
    }
    if (!item.demo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.contact)) {
      const contactLink = document.createElement("a");
      contactLink.href = `mailto:${encodeURIComponent(item.contact)}`;
      contactLink.textContent = item.contact;
      contactDefinition.replaceChildren(contactLink);
    } else {
      contactDefinition.replaceChildren(document.createTextNode(item.contact));
    }
  });
  contactDefinition.append(revealNotice, revealButton);
  details.append(contactTerm, contactDefinition);
  const notice = document.createElement("p");
  notice.className = "detail-notice";
  notice.textContent =
    "Verify ownership privately. Arrange a handover at a public campus location or through campus security.";
  const readButton = document.createElement("button");
  readButton.className = "button secondary read-aloud";
  readButton.type = "button";
  readButton.append(icon("volume-2"), document.createTextNode("Read details aloud"));
  readButton.addEventListener("click", () => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      notify("Voice output is not available in this browser.");
      return;
    }
    if (activeSpeechButton === readButton) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(
      `${item.name}. ${item.status}. ${item.category}. ${item.description}. Location: ${item.location}. Date: ${formatDate(item.date)}.`,
    );
    activeSpeechButton = readButton;
    readButton.lastChild.textContent = "Stop reading";
    utterance.onend = () => finishSpeech(readButton);
    utterance.onerror = (event) => {
      finishSpeech(readButton);
      if (event.error !== "canceled" && event.error !== "interrupted") {
        notify("Voice output could not read this report.");
      }
    };
    window.speechSynthesis.speak(utterance);
  });
  info.append(badge(item.status), title, description, details, notice, readButton);
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
        const pointsSaved = awardContribution("return", current.id);
        const refreshed = await reloadItems();
        notify(
          `${refreshed ? "One less thing lost. Returned status saved to the database." : "Returned status was saved. Retry the connection to refresh the noticeboard."} ${
            pointsSaved
              ? "You earned 20 demo points."
              : "Browser storage could not save your demo points."
          }`,
        );
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
    const savedItem = await apiRequest("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...record, status: submittedType, image }),
    });
    const pointsSaved = awardContribution("report", savedItem.id);
    reportForm.reset();
    document.getElementById("browse-query").value = "";
    document.getElementById("category-filter").value = "all";
    document.getElementById("status-filter").value = "all";
    const refreshed = await reloadItems();
    location.hash = "browse";
    notify(
      `${refreshed ? "Your report is on the noticeboard. Saved to the SQLite database." : "Your report was saved. Retry the connection to refresh the noticeboard."} ${
        pointsSaved
          ? "You earned 10 demo points."
          : "Browser storage could not save your demo points."
      }`,
    );
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
document.getElementById("personal-category").addEventListener("change", (event) => {
  preferences.category = event.target.value;
  if (!saveFeatureState("findit.preferences.v1", preferences)) {
    notify("Dashboard preference changed for this session, but browser storage could not save it.");
  }
  renderPersonalDashboard();
});
document.getElementById("personal-status").addEventListener("change", (event) => {
  preferences.status = event.target.value;
  if (!saveFeatureState("findit.preferences.v1", preferences)) {
    notify("Dashboard preference changed for this session, but browser storage could not save it.");
  }
  renderPersonalDashboard();
});
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
function finishSpeech(button) {
  if (activeSpeechButton !== button) return;
  activeSpeechButton = null;
  button.lastChild.textContent = "Read details aloud";
}
function stopSpeech() {
  if (!activeSpeechButton) return;
  const button = activeSpeechButton;
  activeSpeechButton = null;
  button.lastChild.textContent = "Read details aloud";
  window.speechSynthesis.cancel();
}
dialog.addEventListener("close", stopSpeech);
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
loadFeatureState();
reportForm.querySelector('[type="submit"]').disabled = true;
route();
void reloadItems();
