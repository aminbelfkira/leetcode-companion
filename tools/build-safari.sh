#!/usr/bin/env bash
# Convertit extension/ en projet Xcode « Safari Web Extension » puis le compile.
#
#   ./tools/build-safari.sh
#
# Prérequis (une seule fois, mot de passe administrateur requis) :
#   sudo xcodebuild -license accept
#   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
#
# Le script n'a pas besoin de xcode-select : il force DEVELOPER_DIR lui-même.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT/extension"
BUILD_DIR="$ROOT/build"
APP_NAME="NeetCode Companion"
BUNDLE_ID="fr.sottile.neetcode-companion"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [[ ! -d "$DEVELOPER_DIR" ]]; then
  echo "Xcode introuvable dans $DEVELOPER_DIR." >&2
  echo "Installe Xcode depuis l'App Store, ou exporte DEVELOPER_DIR." >&2
  exit 1
fi

# `-version` répond même sans licence : c'est `-showsdks` qui la réclame.
if ! xcodebuild -showsdks >/dev/null 2>&1; then
  echo "Xcode est présent mais sa licence n'a pas été acceptée." >&2
  echo "Lance une fois, dans un Terminal (mot de passe administrateur) :" >&2
  echo >&2
  echo "    sudo xcodebuild -license accept" >&2
  echo "    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  echo >&2
  echo "puis relance ce script." >&2
  exit 1
fi

echo "▸ Xcode : $(xcodebuild -version | head -1)"

# --- 1. Conversion --------------------------------------------------------
# Le projet référence extension/ : éditer un fichier de l'extension puis
# relancer la compilation suffit, sans reconvertir.
mkdir -p "$BUILD_DIR"
if [[ -d "$BUILD_DIR/$APP_NAME" ]]; then
  echo "▸ Projet Xcode déjà présent, conversion ignorée"
else
  echo "▸ Conversion de extension/ en projet Xcode"
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
  5. dans la même fenêtre, autorise l'extension sur neetcode.io (« Toujours autoriser »).
EOF
