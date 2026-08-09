# NeetCode Companion

Fork de **[aminbelfkira/leetcode-companion](https://github.com/aminbelfkira/leetcode-companion)**,
porté de LeetCode vers **[neetcode.io](https://neetcode.io)** et de Chrome vers **Safari sur
macOS** — tout en restant chargeable dans Chrome sur n'importe quel système.

Seul le volet **flashcards** du projet d'origine est repris :

- après chaque soumission **Accepted**, un panneau demande comment le problème a été résolu et sa
  difficulté ressentie ;
- la prochaine échéance est planifiée par [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) ;
- un badge, un popup et un bandeau sur neetcode.io remontent les problèmes dus.

Le volet **GitHub Sync** de l'original n'est pas porté : NeetCode intègre déjà sa propre
synchronisation GitHub.

Tout est local : aucun compte, aucun serveur, aucune télémétrie. Le code source des solutions
n'est ni lu, ni stocké, ni transmis.

Par rapport à l'original, la réécriture est complète côté outillage : **ni npm, ni bundler, ni
TypeScript**. Il n'y a pas de `package.json` et pas de `npm run build` — le dossier `extension/`
est le produit fini.

---

# Installation

Dans tous les cas, il faut d'abord récupérer le dossier du projet. Rien à compiler, rien à
installer côté Node.

> ⚠️ NeetCode désactive les boutons **Run** et **Submit** tant qu'on n'est pas connecté à son
> compte. Sans connexion, l'extension n'a rien à détecter.

## Sur Windows — Chrome (ou Edge, Brave, Opera)

1. ouvrir `chrome://extensions` (sur Edge : `edge://extensions`) ;
2. activer **Mode développeur**, en haut à droite ;
3. cliquer sur **Charger l'extension non empaquetée** ;
4. sélectionner le dossier **`extension/`** — celui qui contient `manifest.json`, **pas** la racine
   du projet ;
5. ouvrir [neetcode.io](https://neetcode.io), se connecter, résoudre un problème.

L'icône verte apparaît dans la barre d'outils ; le badge indique le nombre de révisions dues.

Il n'y a aucun chemin dépendant du système dans le projet : Windows se comporte exactement comme
macOS ou Linux.

**Firefox n'est pas supporté** : son implémentation de MV3 attend un `background.scripts` là où ce
manifeste déclare un `service_worker`.

## Sur macOS — Chrome

Identique à Windows : `chrome://extensions` ▸ Mode développeur ▸ Charger l'extension non
empaquetée ▸ dossier `extension/`.

## Sur macOS — Safari

Safari n'accepte que des extensions empaquetées dans une application, donc **Xcode est
obligatoire** (gratuit sur l'App Store).

Une seule fois, dans un Terminal — la commande demande le mot de passe administrateur :

```bash
sudo xcodebuild -license accept
```

Puis, à la racine du projet :

```bash
./tools/build-safari.sh
```

Le script convertit `extension/` en projet Xcode dans `build/`, le compile, et affiche le chemin de
l'application produite. Ensuite, dans Safari :

1. ouvrir une fois l'application construite (double-clic) ;
2. Réglages ▸ Avancé ▸ cocher **« Afficher les fonctionnalités pour développeurs web »** ;
3. menu **Développement** ▸ **« Autoriser les extensions non signées »** — à refaire à chaque
   redémarrage de Safari tant que l'application n'est pas signée avec un compte développeur Apple ;
4. Réglages ▸ Extensions ▸ activer **NeetCode Companion** ;
5. dans le même panneau, régler l'accès à `neetcode.io` sur **Toujours autoriser**.

Après une modification dans `extension/`, il suffit de relancer `./tools/build-safari.sh` : le
projet Xcode référence le dossier, il n'est pas reconverti.

---

## Structure

```text
extension/            l'extension elle-même, sans build step
  manifest.json
  background.js       service worker : charge ses dépendances puis démarre
  src/                logique partagée (config, storage, FSRS, endpoints, UI)
  entrypoints/
    interceptor.js    monde MAIN : patch fetch + XHR (injecté dans la page)
    content.js        monde ISOLATED : session, panneau, bandeau
  popup/ options/     interfaces
  vendor/             ts-fsrs 5.4.1 (build UMD, vendorisé)
tests/                faux neetcode.io local + suite de tests navigateur
tools/                icônes, vérification du manifeste, build Safari
```

L'extension n'utilise que des API MV3 communes (`storage`, `alarms`, `tabs`, `action`, `runtime`) ;
`extension/src/config.js` fait le pont entre le global `browser` de Safari et le global `chrome` de
Chrome. Le service worker est un service worker **classique** (`importScripts`, pas de module ES),
précisément pour éviter les écarts entre moteurs.

## Comment la détection fonctionne

NeetCode est une application Angular ; son `HttpClient` passe par `XMLHttpRequest`. L'intercepteur
est injecté dans le contexte de la page (un content script a son propre `XMLHttpRequest` et ne
verrait rien) et surveille trois routes :

| Route                              | Interprétation                                     |
| ---------------------------------- | -------------------------------------------------- |
| `POST /api/executeCodeFunctionHttp` | soumission d'un problème de code                    |
| `POST /api/runSqlFunctionHttp`      | soumission SQL si `runOnly: false`, sinon un « Run » |
| `POST /api/runCodeFunctionHttp`     | bouton « Run » — jamais une soumission              |

Le verdict est lu dans `data.status.description` ; `"Accepted"` déclenche le panneau. Le slug du
problème vient de l'URL, jamais du corps de la requête : le champ `rawCode` n'est donc jamais lu.

Les métadonnées (titre, difficulté) viennent de `POST /api/getProblemMetadataFunctionHttp`, avec un
repli sur le `h1` et la pastille de difficulté de la page si l'appel échoue.

> Ces routes ne sont pas documentées par NeetCode. Si elles changent, tout se corrige dans
> `extension/src/nc-endpoints.js` et `extension/entrypoints/interceptor.js`.

## Notation et planification

| Réponse                 | Grade FSRS   |
| ----------------------- | ------------ |
| Avec aide, ou abandon   | Again        |
| Seul · 4 « à l'arraché » | Hard (ou Again, réglable) |
| Seul · 3 « laborieux »   | Hard         |
| Seul · 2 « correct »     | Good         |
| Seul · 1 « fluide »      | Easy         |

Les pas courts (1 min / 10 min) des flashcards sont désactivés : une révision est toujours
planifiée à la journée. Les réglages (fenêtre anti-doublon, rétention visée, intervalle maximum,
traitement du « à l'arraché ») sont dans la page de réglages de l'extension.

## Tests

Un faux neetcode.io local reproduit les endpoints réels et charge l'extension telle quelle, avec
un simple stub des API `browser.*`. Il ne faut que Python 3, présent d'origine sur macOS :

```bash
python3 tests/serve.py
```

- suite automatique : <http://localhost:8787/problems/duplicate-integer/question?autotest=1>
- page manuelle : <http://localhost:8787/problems/duplicate-integer/question>
- popup : <http://localhost:8787/harness/popup>
- réglages : <http://localhost:8787/harness/options>

La suite couvre le « Run » ignoré, le verdict non Accepted, l'ouverture du panneau, la
prévisualisation d'échéance, l'écriture carte + log, la fenêtre anti-doublon, l'Accepted en
attente, le cas SQL, le repli DOM des métadonnées, le bandeau et le badge.

Vérification du manifeste :

```bash
python3 tools/check-manifest.py
```

Régénérer les icônes :

```bash
python3 tools/make-icons.py
```

## Limites connues

- NeetCode désactive « Run » et « Submit » tant qu'on n'est pas connecté : l'extension ne peut donc
  rien détecter sur une session anonyme.
- Le panneau ne s'ouvre qu'une fois par problème et par fenêtre anti-doublon (8 h par défaut).
  Fermé sans notation, l'Accepted reste rattrapable depuis le popup.
- Le bandeau se superpose à la barre de navigation NeetCode ; « Plus tard » le masque jusqu'au
  lendemain.
- La réinitialisation de l'éditeur à l'ouverture d'une révision (présente dans le projet d'origine)
  n'est pas reprise : NeetCode persiste le code par onglet et l'écraser serait destructif.
