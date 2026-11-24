const count = new Intl.NumberFormat("es-CL");
const leaf = globalThis.L;
const satelliteTemplate = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg";
const satelliteCredit = '<a href="https://cloudless.eox.at/" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 &amp; 2017)';

export async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("No se pudo cargar " + path);
  return response.json();
}

function markerIcon(record, selected = false) {
  const dot = document.createElement("span");
  dot.className = "pin" + (record.revisar ? " review" : "") + (selected ? " selected" : "");
  dot.setAttribute("aria-hidden", "true");
  const size = selected ? 18 : 14;
  return leaf.divIcon({ html: dot, className: "site-marker", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function markerClusterIcon(group) {
  const size = group.getChildCount();
  const issues = group.getAllChildMarkers().filter(marker => marker.options.needsReview).length;
  const dimension = size >= 100 ? 49 : size >= 10 ? 42 : 36;
  const badge = document.createElement("span");
  badge.textContent = count.format(size);
  const detail = count.format(size) + " registros. Acercar el mapa para ver los puntos.";
  badge.title = detail;
  badge.setAttribute("aria-label", detail);
  return leaf.divIcon({
    html: badge,
    className: "site-cluster" + (issues === size ? " all-review" : issues ? " mixed" : ""),
    iconSize: [dimension, dimension],
  });
}

function labelMarker(text, lat, lng, type) {
  const label = document.createElement("span");
  label.textContent = text;
  return leaf.marker([lat, lng], {
    pane: "mapLabels",
    icon: leaf.divIcon({ html: label, className: type, iconAnchor: [0, 0] }),
    interactive: false,
    keyboard: false,
  });
}

export function createMap(container, onPick, showImageryStatus) {
  if (!leaf?.markerClusterGroup) throw new Error("Biblioteca de mapas no disponible");
  const map = leaf.map(container, {
    center: [-41, -71.9],
    zoom: 4.5,
    minZoom: 3,
    maxZoom: 15,
    zoomSnap: .25,
    zoomDelta: .75,
    zoomControl: false,
    scrollWheelZoom: false,
    maxBounds: [[-65, -102], [-13, -52]],
    maxBoundsViscosity: .7,
  });
  leaf.control.zoom({ position: "topleft", zoomInTitle: "Acercar mapa", zoomOutTitle: "Alejar mapa" }).addTo(map);
  leaf.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    '<a href="https://geoportal.cl/geoportal/catalog/36391/division-politica-administrativa-2023" target="_blank" rel="noopener">DPA 2023</a> · ' +
    '<a href="https://geoportal.cl/geoportal/catalog/35252/Catastro%20de%20Lagos" target="_blank" rel="noopener">DGA</a> · ' +
    '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>'
  );
  map.createPane("mapRegions").style.zIndex = "410";
  map.createPane("mapWater").style.zIndex = "420";
  map.createPane("satelliteTiles").style.zIndex = "425";
  map.createPane("mapLabels").style.zIndex = "430";
  let successfulTile = false;
  const satellite = leaf.tileLayer(satelliteTemplate, {
    pane: "satelliteTiles",
    attribution: satelliteCredit,
    maxNativeZoom: 14,
    maxZoom: 15,
    noWrap: true,
    updateWhenIdle: true,
    referrerPolicy: "no-referrer",
  });
  satellite.on({
    loading() {
      successfulTile = false;
      showImageryStatus("Cargando vista satelital…");
    },
    tileload() {
      successfulTile = true;
      container.classList.add("satellite-visible");
    },
    load() {
      if (!map.hasLayer(satellite)) return;
      container.classList.toggle("satellite-visible", successfulTile);
      showImageryStatus(successfulTile ? "" : "La imagen satelital no pudo cargar. Puedes volver a la vista Mapa.");
    },
  });

  function setBasemap(basemap) {
    if (basemap === "satelite") {
      satellite.addTo(map);
    } else {
      satellite.remove();
      container.classList.remove("satellite-visible");
      showImageryStatus("");
    }
  }

  const clusters = leaf.markerClusterGroup({
    maxClusterRadius: zoom => zoom < 7 ? 43 : zoom < 11 ? 35 : 22,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    animate: false,
    iconCreateFunction: markerClusterIcon,
  }).addTo(map);
  const markers = new Map();
  let selectedMarker = null;

  const renderPolygon = leaf.canvas({ pane: "mapRegions", padding: .45 });
  const renderHydro = leaf.canvas({ pane: "mapWater", padding: .4 });
  const countryStyle = { color: "#a5abbd", fillColor: "#f1efe8", weight: 1, fillOpacity: 1 };
  const regionStyle = { color: "#8998b2", fillColor: "#f1f4ee", weight: .85, fillOpacity: 1 };
  const waterStyle = { color: "#a5c5d9", fillColor: "#d0e5f1", weight: .65, fillOpacity: 1 };
  const detailLayers = new Map();
  const coarseLayers = new Map();
  const regionRequests = new Map();
  const labels = leaf.layerGroup().addTo(map);
  let boundsByRegion = {};
  let cities = [];
  let requestedRegions = new Set();

  function renderLabels() {
    labels.clearLayers();
    const zoom = map.getZoom();
    const view = map.getBounds().pad(.05);
    if (zoom < 7) {
      [
        ["Océano Pacífico", -40.65, -82.05, "map-label"],
        ["Argentina", -42.55, -66.45, "map-label land-label"],
      ].forEach(([name, lat, lng, style]) => {
        if (view.contains([lat, lng])) labels.addLayer(labelMarker(name, lat, lng, style));
      });
    }
    for (const [city, lat, lng, minZoom] of cities) {
      if (zoom >= minZoom && view.contains([lat, lng])) {
        labels.addLayer(labelMarker(city, lat, lng, "place-label"));
      }
    }
  }

  function renderRegions() {
    const viewport = map.getBounds().pad(.15);
    requestedRegions = new Set(
      map.getZoom() < 7.75
        ? []
        : Object.entries(boundsByRegion)
          .filter(([, bounds]) => viewport.intersects(leaf.latLngBounds(bounds)))
          .map(([code]) => code)
    );
    for (const [code, layer] of detailLayers) {
      if (!requestedRegions.has(code)) {
        map.removeLayer(layer);
        coarseLayers.get(code).addTo(map);
      }
    }
    for (const code of requestedRegions) {
      const detail = detailLayers.get(code);
      if (detail) {
        coarseLayers.get(code).remove();
        detail.addTo(map);
      } else if (!regionRequests.has(code)) {
        const request = readJson("data/regiones/" + code + ".json")
          .then(data => {
            detailLayers.set(code, leaf.geoJSON(data, {
              pane: "mapRegions", renderer: renderPolygon, style: regionStyle, interactive: false,
            }));
            if (requestedRegions.has(code)) {
              coarseLayers.get(code).remove();
              detailLayers.get(code).addTo(map);
            }
          })
          .catch(() => {})
          .finally(() => regionRequests.delete(code));
        regionRequests.set(code, request);
      }
    }
  }

  function setCartography(data) {
    boundsByRegion = data.limites;
    cities = data.localidades;
    leaf.geoJSON(data.vecinos, { interactive: false, style: countryStyle }).addTo(map);
    for (const feature of data.regiones.features) {
      coarseLayers.set(feature.properties.codigo, leaf.geoJSON(feature, {
        pane: "mapRegions", renderer: renderPolygon, interactive: false, style: regionStyle,
      }).addTo(map));
    }
    leaf.geoJSON(data.lagos, {
      pane: "mapWater", renderer: renderHydro, interactive: false, style: waterStyle,
    }).addTo(map);
    renderLabels();
    renderRegions();
  }

  function addRecords(records) {
    const mappable = records.filter(record => record.latitud !== null);
    let selectedWasVisible = false;
    const layers = mappable.map(record => {
      if (!markers.has(record.id)) {
        const marker = leaf.marker([record.latitud, record.longitud], {
          icon: markerIcon(record),
          title: record.nombre + " · ID " + record.id,
          alt: record.nombre,
          riseOnHover: true,
          needsReview: record.revisar,
        });
        marker.on("click", () => onPick(record));
        markers.set(record.id, marker);
      }
      const marker = markers.get(record.id);
      if (marker === selectedMarker) selectedWasVisible = true;
      return marker;
    });
    if (!selectedWasVisible && selectedMarker) {
      const previous = selectedMarker.siteRecord;
      if (previous) selectedMarker.setIcon(markerIcon(previous));
      selectedMarker = null;
    }
    clusters.clearLayers();
    clusters.addLayers(layers);
  }

  function fit(records) {
    const points = records.filter(record => record.latitud !== null);
    if (!points.length) return;
    map.fitBounds(leaf.latLngBounds(points.map(record => [record.latitud, record.longitud])), {
      padding: [35, 30], maxZoom: points.length === 1 ? 11 : 12, animate: false,
    });
  }

  function focusRecord(record) {
    const marker = markers.get(record.id);
    if (!marker || !clusters.hasLayer(marker)) return;
    if (selectedMarker && selectedMarker !== marker && selectedMarker.siteRecord) {
      selectedMarker.setIcon(markerIcon(selectedMarker.siteRecord));
    }
    marker.siteRecord = record;
    selectedMarker = marker;
    marker.setIcon(markerIcon(record, true));
    map.setView(marker.getLatLng(), Math.max(13, map.getZoom()), { animate: false });
    clusters.zoomToShowLayer(marker, () => marker.getElement()?.focus({ preventScroll: true }));
  }

  map.on("moveend zoomend", () => {
    renderLabels();
    renderRegions();
  });
  new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true })).observe(container);
  return { setCartography, addRecords, fit, focusRecord, setBasemap };
}
