# Companion

Extension Chrome locale qui suit les problèmes résolus sur
[LeetCode](https://leetcode.com) **et** [NeetCode](https://neetcode.io), puis planifie les révisions
avec [FSRS](https://github.com/open-spaced-repetition/ts-fsrs).

Ce projet fusionne les workflows de
[neetcode-companion](https://github.com/axlstl/neetcode-companion) et
[leetcode-companion](https://github.com/aminbelfkira/leetcode-companion) dans une seule extension.

## Ce que fait l'extension

- détecte uniquement les vraies soumissions **Accepted** sur les deux sites ;
- ignore les boutons **Run** ;
- affiche le même panneau de notation après un Accepted ;
- conserve une seule carte et un seul planning FSRS lorsqu'un problème est fait sur les deux sites ;
- montre les révisions dues dans le badge, le popup et un bandeau sur chaque site ;
- ouvre une révision sur LeetCode lorsqu'une source LeetCode existe, sinon sur NeetCode ;
- restaure le code initial de l'éditeur LeetCode lorsqu'une révision est lancée depuis Companion ;
- migre automatiquement les anciennes cartes NeetCode au premier démarrage.

Tout le planning reste dans `chrome.storage.local` — ce ne sont pas des cookies. Le code des
solutions n'est ni lu, ni stocké, ni envoyé.

## Import et sauvegarde locale

Le bouton **Réglages** du popup ouvre la section **Sauvegardes** :

- **Importer un JSON** accepte les exports Companion actuels et ceux des anciennes extensions ;
- l'import fusionne les cartes, les sources et l'historique sans supprimer les données présentes ;
- **Choisir un dossier** active une sauvegarde automatique dans le dossier sélectionné ;
- si ce dossier contient déjà `companion-backup.json`, Companion propose de l'importer et de le
  fusionner, ou de le remplacer avec les données courantes ;
- après chaque révision, `companion-backup.json` est réécrit avec l'état complet ;
- l'export manuel horodaté reste disponible dans le popup et dans les réglages.

Le dossier est choisi avec l'API File System Access de Chrome. Son autorisation est mémorisée
localement par l'extension ; si Chrome la suspend après un redémarrage, le bouton **Réautoriser**
la réactive. **Oublier le dossier** coupe le lien sans supprimer le fichier déjà créé.

`chrome.storage.local` survit au nettoyage de l'historique et du cache, mais pas à la désinstallation
de l'extension. Le fichier automatique sert précisément de copie indépendante dans ce cas.

## Fusion des noms sans doublons

Le slug n'est pas utilisé seul : `duplicate-integer` sur NeetCode et `contains-duplicate` sur
LeetCode représentent par exemple le même problème.

La résolution d'identité suit cet ordre :

1. alias NeetCode → LeetCode connus pour les divergences du NeetCode 250 ;
2. source et identifiant LeetCode déjà observés ;
3. titre normalisé (casse, accents et ponctuation ignorés) ;
4. rapprochement conservateur pour une variation mineure et non ambiguë du titre.

La carte commune garde ensuite les deux sources. Le cooldown est appliqué à cette carte, pas au
site : résoudre le même problème sur l'autre plateforme ne crée donc pas une deuxième révision.

## Installation dans Chrome

### Utilisateur — sans Node.js

Télécharger l'archive `leetcode-neetcode-companion-…-chrome.zip` de la dernière
[GitHub Release](https://github.com/axlstl/neetcode-companion/releases), la décompresser, puis :

1. ouvrir `chrome://extensions` ;
2. activer **Mode développeur** ;
3. cliquer sur **Charger l'extension non empaquetée** ;
4. sélectionner le dossier décompressé, celui qui contient directement `manifest.json`.

Le ZIP est aussi le paquet à envoyer dans le Chrome Web Store. Pour une installation réellement en
un clic et des mises à jour automatiques, la distribution finale doit passer par le Web Store.

### Développeur — depuis les sources

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run build
```

Puis charger `output/chrome-mv3/` dans `chrome://extensions` avec **Charger l'extension non
empaquetée**.

## Publier une version

Les fichiers générés restent hors de Git. Un tag de version déclenche GitHub Actions, exécute les
tests, construit le ZIP Chrome et l'attache automatiquement à une GitHub Release :

```bash
npm version patch
git push origin main --follow-tags
```

La version de `package.json`, du manifest généré et du nom de l'archive reste ainsi synchronisée.

NeetCode exige une connexion au compte pour activer ses boutons Run/Submit. LeetCode et NeetCode
peuvent faire évoluer leurs endpoints non documentés ; la logique correspondante est isolée dans
`src/lc-endpoints.ts` et `src/nc-endpoints.ts`.

## Développement

```bash
npm run dev
npm test
npm run compile
npm run build
npm run zip
```

La suite couvre FSRS, la détection NeetCode, la détection LeetCode, la fusion d'identité et le
stockage unifié.

## Structure

```text
entrypoints/
  background.ts                    stockage single-writer, badge et messages
  interceptor.ts                   intercepteur MAIN NeetCode
  neetcode.content.ts              session et UI NeetCode
  leetcode-interceptor.content.ts  intercepteur MAIN LeetCode
  leetcode.content.ts              session et UI LeetCode
  popup/ options/                   interfaces Chrome
src/
  problem-identity.ts              alias, normalisation et résolution anti-doublon
  lc-endpoints.ts lc-meta.ts        détection et métadonnées LeetCode
  nc-endpoints.ts nc-meta.ts        détection et métadonnées NeetCode
  review.ts storage.ts              FSRS, migration et carte multi-plateforme
  backup.ts backup-directory.ts     import fusionné et sauvegarde dans un dossier choisi
  ui/                               panneau, bandeau et reset LeetCode
tests/
```
