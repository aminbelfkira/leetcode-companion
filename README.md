# LeetCode × FSRS

Extension Chrome **100 % locale** qui transforme le grind LeetCode en révision espacée ([FSRS](https://github.com/open-spaced-repetition/ts-fsrs)).

À chaque **Accepted** sur leetcode.com, un petit panneau apparaît : deux taps (résolu seul / avec aide, difficulté ressentie 1–4) et la prochaine date de révision est planifiée. Les problèmes dus remontent via le badge de l'icône, le popup et un fin bandeau sur leetcode.com.

Zéro saisie manuelle, zéro serveur, zéro compte. Le code soumis n'est jamais lu ni stocké — métadonnées uniquement (numéro, titre, difficulté, ressenti).

## Installation

```bash
npm install
npm run build
```

Puis dans Chrome :

1. `chrome://extensions`
2. Activer le **mode développeur** (en haut à droite)
3. **Charger l'extension non empaquetée** → sélectionner `output/chrome-mv3/`

Pour développer : `npm run dev` (rechargement automatique).

## Utilisation

- **Résolvez un problème** sur leetcode.com et soumettez. Au verdict Accepted, le panneau de notation apparaît en bas à droite. (« Run » est ignoré, seuls les vrais Submit comptent.)
- **Badge rouge** sur l'icône : nombre de révisions dues.
- **Popup** : liste des dus (Ouvrir), à venir, abandon d'une révision (→ à revoir demain), notation d'un Accepted dont le panneau a été fermé par erreur.
- **Bandeau** en haut de leetcode.com quand des révisions sont dues — « Plus tard » le masque jusqu'à demain.

## Export des données

Popup → **Exporter (JSON)** : télécharge cartes, journal de révisions et réglages (`schemaVersion`, `cards`, `log`, `settings`). Tout vit dans `chrome.storage.local` ; aucune donnée ne quitte la machine.
