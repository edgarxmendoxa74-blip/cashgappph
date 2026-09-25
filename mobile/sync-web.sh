#!/bin/bash
# Copies the CashG web app (repo root) into mobile/www for the Android build.
# Run from anywhere:  bash mobile/sync-web.sh
set -euo pipefail

MOBILE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$MOBILE/.." && pwd)"
DEST="$MOBILE/www"

rm -rf "$DEST"
mkdir -p "$DEST/vendor"

# App files only (no admin/, supabase/, mobile/, node_modules)
cp "$SRC"/index.html "$SRC"/styles.css "$SRC"/*.js "$SRC"/manifest.webmanifest "$DEST"/
cp -r "$SRC"/icons "$DEST"/
rm -f "$DEST/sw.js"

# Bundle the Supabase library so the app starts without internet
curl -fsSL -o "$DEST/vendor/supabase.js" "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"
sed -i 's#<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>#<script src="vendor/supabase.js"></script>#' "$DEST/index.html"
grep -q 'vendor/supabase.js' "$DEST/index.html" || { echo "Supabase script tag not found in index.html" >&2; exit 1; }

# The APK ships its own files, so the service worker would only serve stale copies after an update
sed -i "s#if ('serviceWorker' in navigator && location.protocol !== 'file:') {#if (false) { // service worker disabled in the Android app#" "$DEST/script.js"
grep -q 'service worker disabled in the Android app' "$DEST/script.js" || { echo "Service worker registration not found in script.js" >&2; exit 1; }

echo "Copied web app to $DEST"
