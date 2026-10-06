#!/bin/sh
# Sets up Kav for the web: dependencies, the offline map, this week's timetable, and the app itself.
# Run it again every week or two to refresh the timetable.
set -e
cd "$(dirname "$0")"
mkdir -p data

npm install

if [ ! -f data/israel.pmtiles ]; then
  echo "Fetching the map (185 MB, once)…"
  curl -fSL --retry 3 -o data/israel.pmtiles.part https://github.com/ImNoammm/kav/releases/download/map-1/israel.pmtiles
  mv data/israel.pmtiles.part data/israel.pmtiles
fi

echo "Fetching the Ministry of Transport timetable (~180 MB) and building this week's bundle…"
../tools/fetch.sh
KAV_REGION=il KAV_BBOX=national KAV_OUT="$PWD/data" python3 ../tools/export_web_bundle.py

npm run build
echo
echo "Done. Start Kav with:  npm start"
