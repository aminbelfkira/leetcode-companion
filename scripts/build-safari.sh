#!/usr/bin/env bash
# Convertit la build MV3 en projet Xcode « Safari Web Extension » puis la compile.
#
#   npm run safari          (build WXT + ce script)
#   ./scripts/build-safari.sh   (si output/chrome-mv3 est déjà à jour)
#
# Prérequis, une seule fois, avec le mot de passe administrateur :
#   sudo xcodebuild -license accept
#
# Le script force DEVELOPER_DIR, il n'a donc pas besoin de xcode-select.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT/output/chrome-mv3"
BUILD_DIR="$ROOT/output/safari"
APP_NAME="NeetCode Companion"
# Le convertisseur dérive l'identifiant de l'application du nom de l'app, mais
# celui de l'extension de ce réglage, en y ajoutant « .Extension ». Les deux
# doivent donc coïncider, sinon Xcode rejette la validation du binaire embarqué.
BUNDLE_ID="fr.sottile.NeetCode-Companion"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [[ ! -d "$EXTENSION_DIR" ]]; then
  echo "Build introuvable dans $EXTENSION_DIR. Lance d'abord : npm run build" >&2
  exit 1
fi

if [[ ! -d "$DEVELOPER_DIR" ]]; then
  echo "Xcode introuvable dans $DEVELOPER_DIR." >&2
  echo "Installe Xcode depuis l'App Store, ou exporte DEVELOPER_DIR." >&2
  exit 1
fi

# `xcodebuild -version` répond même sans licence : c'est `-showsdks` qui la réclame.
if ! xcodebuild -showsdks >/dev/null 2>&1; then
  echo "Xcode est présent mais sa licence n'a pas été acceptée." >&2
  echo "Lance une fois, dans un Terminal :" >&2
  echo >&2
  echo "    sudo xcodebuild -license accept" >&2
  echo >&2
  echo "puis relance ce script." >&2
  exit 1
fi

echo "▸ Xcode : $(xcodebuild -version | head -1)"

# --- 1. Conversion --------------------------------------------------------
# Le projet référence output/chrome-mv3 : après un nouveau `npm run build`,
# il suffit de recompiler, sans reconvertir.
mkdir -p "$BUILD_DIR"
if [[ -d "$BUILD_DIR/$APP_NAME" ]]; then
  echo "▸ Projet Xcode déjà présent, conversion ignorée"
else
  echo "▸ Conversion de output/chrome-mv3 en projet Xcode"
  xcrun safari-web-extension-converter "$EXTENSION_DIR" \
    --project-location "$BUILD_DIR" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --macos-only \
    --no-open \
    --no-prompt \
    --force
fi

# --- 2. Compilation -------------------------------------------------------
PROJECT="$BUILD_DIR/$APP_NAME/$APP_NAME.xcodeproj"
echo "▸ Compilation ($PROJECT)"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  CODE_SIGN_IDENTITY=- \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  build

APP="$BUILD_DIR/DerivedData/Build/Products/Release/$APP_NAME.app"
echo
echo "✓ Application construite : $APP"
cat <<'EOF'

Pour l'activer dans Safari :
  1. ouvre l'application construite (double-clic) une fois ;
  2. Safari ▸ Réglages ▸ Avancé ▸ « Afficher les fonctionnalités pour développeurs web » ;
  3. Safari ▸ menu Développement ▸ « Autoriser les extensions non signées »
     (à refaire à chaque redémarrage de Safari tant que l'app n'est pas signée) ;
  4. Safari ▸ Réglages ▸ Extensions ▸ coche « NeetCode Companion » ;
  5. dans la même fenêtre, règle l'accès à neetcode.io sur « Toujours autoriser ».
EOF
