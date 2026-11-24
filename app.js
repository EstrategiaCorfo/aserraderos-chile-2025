import { createMap, readJson } from "./map.js";

const number = new Intl.NumberFormat("es-CL");
const coordinates = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 8, useGrouping: false });
const distance = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const alphabet = new Intl.Collator("es-CL", { sensitivity: "base", numeric: true });
const byId = id => document.getElementById(id);
const fields = Object.fromEntries(
  ["query", "region", "comuna", "situacion", "movilidad", "revision"].map(key => [key, byId(key)])
);
const sortHeaders = [...document.querySelectorAll("th[data-key]")];
const basemapButtons = [...document.querySelectorAll("button[data-basemap]")];
const dialog = byId("plant-dialog");
const tableBody = byId("table-body");
let allRecords = [];
let matchedRecords = [];
let index = new Map();
let map = null;
let selected = null;
let page = 0;
let pageSize = 25;
let sortKey = "id";
let ascending = true;
let debounceId;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== null && content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function normalize(value) {
  return (value ?? "").toString().normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function plural(value, singular, multiple = singular + "s") {
  return number.format(value) + " " + (value === 1 ? singular : multiple);
}

function populateSelect(control, values, defaultLabel) {
  const previous = control.value;
  control.replaceChildren(new Option(defaultLabel, ""), ...values.map(value => new Option(value)));
  if (values.includes(previous)) control.value = previous;
}

function updateCommunes() {
  const region = fields.region.value;
  const communes = new Set(allRecords.filter(record => !region || record.region === region).map(record => record.comuna));
  populateSelect(fields.comuna, [...communes].sort(alphabet.compare), "Todas");
}

function matchRecords() {
  const { query, region, comuna, situacion, movilidad, revision } = Object.fromEntries(
    Object.entries(fields).map(([key, control]) => [key, control.value.trim()])
  );
  const cleanQuery = normalize(query);
  const exactId = cleanQuery.match(/^(?:id )?(\d+)$/)?.[1];
  const terms = cleanQuery.split(" ").filter(Boolean);

  return allRecords.filter(record => {
    if (region && record.region !== region) return false;
    if (comuna && record.comuna !== comuna) return false;
    if (situacion && record.situacion !== situacion) return false;
    if (movilidad && record.movilidad !== movilidad) return false;
    if (revision === "revisar" && !record.revisar) return false;
    if (revision === "sin-alerta" && record.revisar) return false;
    if (revision === "no-mapeable" && record.latitud !== null) return false;
    if (exactId) return record.id === Number(exactId);
    return terms.every(term => record.search.includes(term));
  });
}

function badge(text, kind) {
  return element("span", text, "status-pill " + kind);
}

function operationalBadge(record) {
  return badge(record.situacion, record.situacion === "Trabajando" ? "working" : "inactive");
}

function reviewBadge(record) {
  if (record.latitud === null) return badge("Sin punto", "attention");
  return record.revisar ? badge("Por verificar", "attention") : badge("Sin observación", "clear");
}

function makeRow(record) {
  const row = document.createElement("tr");
  row.dataset.id = record.id;

  const nameCell = document.createElement("td");
  const name = element("button", record.nombre, "plant-link");
  name.type = "button";
  name.setAttribute("aria-label", "Ver ficha de " + record.nombre + ", ID " + record.id);
  nameCell.append(name);

  const location = element("td", null, "place-cell");
  location.append(element("span", record.comuna), element("small", record.region));
  const situation = document.createElement("td");
  situation.append(operationalBadge(record));
  const review = document.createElement("td");
  review.append(reviewBadge(record));

  row.append(element("td", record.id), nameCell, location, situation, element("td", record.movilidad),
    element("td", record.tipoEspecie ?? "—"), review);
  return row;
}

function renderTable() {
  const ordered = [...matchedRecords].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const ordering = (sortKey === "id" || sortKey === "revisar")
      ? Number(left) - Number(right)
      : alphabet.compare(left ?? "", right ?? "");
    return (ascending ? ordering : -ordering) || a.id - b.id;
  });

  const totalPages = Math.ceil(ordered.length / pageSize);
  page = Math.min(page, Math.max(0, totalPages - 1));
  const start = page * pageSize;
  const end = Math.min(start + pageSize, ordered.length);
  tableBody.replaceChildren(...ordered.slice(start, end).map(makeRow));
  if (ordered.length === 0) {
    const row = document.createElement("tr");
    const empty = element("td", "No hay aserraderos que coincidan con los filtros.", "table-empty");
    empty.colSpan = 7;
    row.append(empty);
    tableBody.append(row);
  }
  byId("table-total").textContent = plural(ordered.length, "registro");
  byId("page-status").textContent = ordered.length
    ? number.format(start + 1) + "–" + number.format(end) + " de " + number.format(ordered.length)
    : "0 registros";
  byId("previous").disabled = page === 0;
  byId("next").disabled = page + 1 >= totalPages;
  for (const header of sortHeaders) {
    const marker = header.querySelector("button span");
    marker.replaceChildren();
    if (header.dataset.key === sortKey) {
      header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      marker.append(element("i"));
    } else {
      header.removeAttribute("aria-sort");
    }
  }
}

function regionCounts(rows) {
  const totals = new Map();
  for (const row of rows) totals.set(row.region, (totals.get(row.region) ?? 0) + 1);
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || alphabet.compare(a[0], b[0]));
}

function renderRanking() {
  const ranking = regionCounts(matchedRecords).slice(0, 5);
  const list = byId("regional-rank");
  list.replaceChildren();
  if (!ranking.length) {
    list.append(element("li", "Sin registros para esta selección.", "rank-empty"));
  }
  for (const [region, tally] of ranking) {
    const item = document.createElement("li");
    const control = element("button", null, "rank-button");
    control.type = "button";
    control.setAttribute("aria-pressed", String(fields.region.value === region));
    control.setAttribute("aria-label", "Filtrar por " + region + ", " + plural(tally, "registro"));
    control.addEventListener("click", () => {
      fields.region.value = fields.region.value === region ? "" : region;
      updateCommunes();
      applyFilters();
    });
    const label = element("span", null, "rank-line");
    label.append(element("span", region), element("strong", number.format(tally)));
    const track = element("span", null, "rank-track");
    const fill = element("i");
    fill.style.setProperty("--fill", Math.round(tally / ranking[0][1] * 100) + "%");
    track.setAttribute("aria-hidden", "true");
    track.append(fill);
    control.append(label, track);
    item.append(control);
    list.append(item);
  }
  const reviews = matchedRecords.filter(record => record.revisar).length;
  const checking = fields.revision.value === "revisar";
  byId("review-count").textContent = number.format(reviews);
  byId("review-shortcut").setAttribute("aria-pressed", String(checking));
  byId("review-shortcut").disabled = !checking && reviews === 0;
}

function setMessage(id, message) {
  const host = byId(id);
  host.textContent = message;
  host.hidden = !message;
}

function updateMap() {
  const showable = matchedRecords.filter(record => record.latitud !== null);
  const notShowable = matchedRecords.length - showable.length;
  const caption = plural(showable.length, "registro en el mapa", "registros en el mapa");
  byId("map-count").textContent = caption + (notShowable ? " · " + plural(notShowable, "sin punto representable", "sin punto representable") : "");
  byId("recenter").disabled = !map || showable.length === 0;
  if (!map) {
    setMessage("map-message", "El mapa no está disponible. Puedes consultar la tabla.");
    return;
  }
  map.addRecords(matchedRecords);
  map.fit(matchedRecords);
  setMessage("map-message", showable.length ? "" : "Los filtros actuales no tienen puntos para mostrar.");
}

function renderActiveFilters() {
  const active = byId("active-filters");
  active.replaceChildren();
  for (const [key, control] of Object.entries(fields)) {
    if (!control.value.trim()) continue;
    const label = control.closest("label").firstElementChild.textContent;
    const value = key === "query" ? control.value.trim() : control.selectedOptions[0].text;
    const chip = element("button", null, "filter-chip");
    chip.type = "button";
    chip.setAttribute("aria-label", "Quitar filtro " + label + ": " + value);
    const close = element("span", "×");
    close.setAttribute("aria-hidden", "true");
    chip.append(element("span", value), close);
    chip.addEventListener("click", () => {
      control.value = "";
      if (key === "region") updateCommunes();
      applyFilters();
      control.focus();
    });
    active.append(chip);
  }
  if (!active.childElementCount) active.textContent = "Ninguno";
  byId("reset-filters").disabled = !active.childElementCount;
}

function renderSummary() {
  const working = matchedRecords.filter(record => record.situacion === "Trabajando").length;
  byId("hero-total").textContent = number.format(matchedRecords.length);
  byId("hero-operating").textContent = number.format(working);
  byId("hero-inactive").textContent = number.format(matchedRecords.length - working);
}

function applyFilters() {
  window.clearTimeout(debounceId);
  page = 0;
  matchedRecords = matchRecords();
  renderActiveFilters();
  renderSummary();
  renderRanking();
  renderTable();
  updateMap();
}

function detailSection(title, pairs) {
  const shown = pairs.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!shown.length) return null;
  const section = document.createElement("section");
  section.append(element("h3", title));
  const list = element("dl", null, "detail-list");
  for (const [label, value] of shown) {
    const entry = document.createElement("div");
    entry.append(element("dt", label), element("dd", value));
    list.append(entry);
  }
  section.append(list);
  return section;
}

function showPlant(record) {
  selected = record;
  byId("plant-id").textContent = "Aserradero " + record.id;
  byId("plant-name").textContent = record.nombre;
  byId("plant-location").textContent = record.comuna + " · " + record.region;
  const host = byId("plant-details");
  const badges = element("div", null, "dialog-badges");
  badges.append(operationalBadge(record), badge(record.movilidad, "clear"), reviewBadge(record));
  host.replaceChildren(badges);

  const context = detailSection("Ubicación declarada", [
    ["Región", record.regionCompleta], ["Provincia", record.provincia], ["Comuna", record.comuna],
    ["Localidad", record.localidad], ["Dirección", record.direccion],
  ]);
  const production = detailSection("Información productiva", [
    ["Tipo de especie", record.tipoEspecie], ["Especies", record.especies],
    ["Productos", record.productos], ["Elaboración", record.elaboracion],
    ["Estrato de producción 2025", record.produccion],
    ["Capacidad instalada a un turno", record.capacidad === null ? null : number.format(record.capacidad) + " m³"],
    ["Turnos por día", record.turnos],
  ]);
  const audit = detailSection("Revisión geográfica", [
    ["Diagnóstico", record.diagnostico],
    ["Latitud", record.latitud === null ? null : coordinates.format(record.latitud)],
    ["Longitud", record.longitud === null ? null : coordinates.format(record.longitud)],
    ["Latitud original", record.coordenadasOrigen?.[0]],
    ["Longitud original", record.coordenadasOrigen?.[1]],
    ["Comuna según DPA", record.revisar ? record.comunaDpa : null],
    ["Provincia según DPA", record.diagnostico === "Comuna distinta" ? record.provinciaDpa : null],
    ["Región según DPA", record.diagnostico === "Comuna distinta" ? record.regionDpa : null],
    ["Distancia a comuna declarada", record.revisar && record.distanciaComuna > 0 ? distance.format(record.distanciaComuna) + " m" : null],
    ["IDs con el mismo punto", record.coincidencias.length ? record.coincidencias.join(", ") : null],
    ["Fila en el directorio", record.filaDirectorio],
  ]);
  if (record.observacion) audit.append(element("p", record.observacion, "observation-note"));
  host.append(...[context, production, audit].filter(Boolean));
  byId("locate-plant").hidden = !map || record.latitud === null;
  if (!dialog.open) dialog.showModal();
  host.scrollTop = 0;
}

function setActiveLink(hash) {
  for (const link of document.querySelectorAll(".topbar nav a")) {
    if (link.hash === hash) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

function connectControls() {
  byId("filters").addEventListener("submit", event => {
    event.preventDefault();
    applyFilters();
  });
  fields.query.addEventListener("input", () => {
    window.clearTimeout(debounceId);
    debounceId = window.setTimeout(applyFilters, 140);
  });
  for (const [key, control] of Object.entries(fields)) {
    if (key === "query") continue;
    control.addEventListener("change", () => {
      if (key === "region") updateCommunes();
      applyFilters();
    });
  }
  byId("reset-filters").addEventListener("click", () => {
    byId("filters").reset();
    updateCommunes();
    applyFilters();
    fields.query.focus();
  });
  byId("review-shortcut").addEventListener("click", () => {
    fields.revision.value = fields.revision.value === "revisar" ? "" : "revisar";
    applyFilters();
  });
  byId("recenter").addEventListener("click", () => map?.fit(matchedRecords));
  for (const button of basemapButtons) {
    button.disabled = !map;
    button.addEventListener("click", () => {
      map.setBasemap(button.dataset.basemap);
      for (const option of basemapButtons) option.setAttribute("aria-pressed", String(option === button));
    });
  }

  for (const header of sortHeaders) {
    header.querySelector("button").addEventListener("click", () => {
      const key = header.dataset.key;
      ascending = sortKey === key ? !ascending : key !== "revisar";
      sortKey = key;
      page = 0;
      renderTable();
    });
  }
  tableBody.addEventListener("click", event => {
    const row = event.target.closest("tr[data-id]");
    if (row) showPlant(index.get(Number(row.dataset.id)));
  });
  byId("page-size").addEventListener("change", event => {
    pageSize = Number(event.target.value);
    page = 0;
    renderTable();
  });
  byId("previous").addEventListener("click", () => { page -= 1; renderTable(); });
  byId("next").addEventListener("click", () => { page += 1; renderTable(); });

  byId("close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) dialog.close();
  });
  byId("locate-plant").addEventListener("click", () => {
    if (!selected || !map) return;
    dialog.close();
    byId("titulo-mapa").scrollIntoView({ block: "start" });
    setActiveLink("#mapa");
    map.focusRecord(selected);
  });
  document.querySelector(".topbar nav").addEventListener("click", event => {
    const link = event.target.closest("a");
    if (link) setActiveLink(link.hash);
  });
  window.addEventListener("hashchange", () => setActiveLink(location.hash || "#mapa"));
  setActiveLink(location.hash || "#mapa");
}

async function launch() {
  allRecords = await readJson("data/aserraderos.json");
  for (const record of allRecords) {
    record.search = normalize([record.nombre, record.comuna, record.localidad, record.region, record.direccion].filter(Boolean).join(" "));
  }
  index = new Map(allRecords.map(record => [record.id, record]));
  populateSelect(fields.region, [...new Set(allRecords.map(record => record.region))], "Todas");
  updateCommunes();

  try {
    map = createMap(byId("map"), showPlant, message => setMessage("imagery-status", message));
    readJson("data/cartografia.json").then(data => map.setCartography(data)).catch(() => {
      setMessage("map-message", "La cartografía base no está disponible. Los puntos del directorio siguen visibles.");
    });
  } catch {
    setMessage("map-message", "El mapa no está disponible. Puedes consultar la tabla.");
  }

  connectControls();
  applyFilters();
  if (map) {
    const initialBasemap = basemapButtons.find(button => button.getAttribute("aria-pressed") === "true");
    map.setBasemap(initialBasemap.dataset.basemap);
  }
}

launch().catch(() => {
  byId("map-count").textContent = "No se pudo cargar el directorio.";
  byId("table-total").textContent = "Directorio no disponible";
  setMessage("map-message", "No se pudo cargar el directorio. Recarga esta página para volver a intentar.");
});
