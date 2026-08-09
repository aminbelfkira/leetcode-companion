#!/usr/bin/env python3
"""Vérifie que le manifeste est valide et que tous les fichiers cités existent.

    python3 tools/check-manifest.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTENSION = os.path.join(ROOT, "extension")


def collect_referenced(manifest):
    paths = []
    for size_map in (manifest.get("icons", {}), manifest.get("action", {}).get("default_icon", {})):
        paths.extend(size_map.values())
    paths.append(manifest["background"]["service_worker"])
    paths.append(manifest["action"]["default_popup"])
    paths.append(manifest["options_ui"]["page"])
    for script in manifest.get("content_scripts", []):
        paths.extend(script.get("js", []))
        paths.extend(script.get("css", []))
    for entry in manifest.get("web_accessible_resources", []):
        paths.extend(entry.get("resources", []))
    return paths


def html_local_sources(path):
    """src/href relatifs déclarés dans une page HTML de l'extension."""
    with open(path, "r", encoding="utf-8") as handle:
        html = handle.read()
    found = re.findall(r'(?:src|href)="([^"]+)"', html)
    return [ref for ref in found if not ref.startswith(("http:", "https:", "data:", "#"))]


def main():
    errors = []
    manifest_path = os.path.join(EXTENSION, "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    for relative in collect_referenced(manifest):
        if not os.path.isfile(os.path.join(EXTENSION, relative)):
            errors.append(f"manifest.json → fichier manquant : {relative}")

    # Chaque importScripts du service worker doit exister aussi.
    worker = os.path.join(EXTENSION, manifest["background"]["service_worker"])
    with open(worker, "r", encoding="utf-8") as handle:
        for relative in re.findall(r'"(/[^"]+\.js)"', handle.read()):
            if not os.path.isfile(os.path.join(EXTENSION, relative.lstrip("/"))):
                errors.append(f"background.js → importScripts manquant : {relative}")

    for page in (manifest["action"]["default_popup"], manifest["options_ui"]["page"]):
        page_path = os.path.join(EXTENSION, page)
        page_dir = os.path.dirname(page_path)
        for ref in html_local_sources(page_path):
            target = os.path.normpath(os.path.join(page_dir, ref))
            if not os.path.isfile(target):
                errors.append(f"{page} → référence manquante : {ref}")

    orphans = []
    referenced = {
        os.path.normpath(os.path.join(EXTENSION, p)) for p in collect_referenced(manifest)
    }
    for page in (manifest["action"]["default_popup"], manifest["options_ui"]["page"]):
        page_path = os.path.join(EXTENSION, page)
        referenced.add(os.path.normpath(page_path))
        for ref in html_local_sources(page_path):
            referenced.add(os.path.normpath(os.path.join(os.path.dirname(page_path), ref)))
    referenced.add(os.path.join(EXTENSION, "manifest.json"))
    with open(worker, "r", encoding="utf-8") as handle:
        for relative in re.findall(r'"(/[^"]+\.js)"', handle.read()):
            referenced.add(os.path.normpath(os.path.join(EXTENSION, relative.lstrip("/"))))

    for dirpath, _dirnames, filenames in os.walk(EXTENSION):
        for name in filenames:
            full = os.path.normpath(os.path.join(dirpath, name))
            if name.startswith("."):
                continue
            if full not in referenced:
                orphans.append(os.path.relpath(full, EXTENSION))

    for orphan in sorted(orphans):
        print(f"note : {orphan} n'est référencé nulle part")

    if errors:
        for error in errors:
            print(f"ERREUR : {error}", file=sys.stderr)
        return 1

    print(f"✓ manifeste valide, {len(referenced)} fichiers référencés présents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
