# Aserraderos de Chile · Catastro 2025

Visor del catastro de la industria del aserrío levantado por el Instituto Forestal (INFOR). Incluye un mapa interactivo y un directorio con filtros compartidos. El mapa abre en la vista Satélite y se puede cambiar a Mapa. La base contiene 1.228 establecimientos, con 30 registros marcados para verificación geográfica.

## Uso local

Ejecuta `python -m http.server 8000` desde la raíz del repositorio y abre `http://localhost:8000` en tu navegador. La vista satelital requiere conexión a Internet.

## Fuentes

El visor identifica las fuentes del catastro y de la cartografía. La vista satelital utiliza [EOxCloudless](https://cloudless.eox.at/) con datos Copernicus Sentinel 2016–2017. Las licencias de Leaflet, Leaflet.markercluster y Carlito están en `vendor/`.
