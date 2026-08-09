# NeetCode Companion

Fork de **[aminbelfkira/leetcode-companion](https://github.com/aminbelfkira/leetcode-companion)**,
porté de LeetCode vers **[neetcode.io](https://neetcode.io)**, et de Chrome vers **Safari sur
macOS**.

Seul le volet flashcards du projet d'origine est repris :

- après chaque soumission **Accepted**, un panneau demande comment le problème a été résolu et sa
  difficulté ressentie ;
- la prochaine échéance est planifiée par [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) ;
- un badge, un popup et un bandeau sur neetcode.io remontent les problèmes dus.

Le volet GitHub Sync de l'original n'est pas porté, NeetCode intégrant déjà sa propre
synchronisation GitHub.

Tout fonctionne localement. Le code source des solutions n'est ni lu, ni stocké, ni transmis.

## Installation

Prérequis communs : **Node 20 ou plus récent**. L'extension se construit avec
[WXT](https://wxt.dev), qui produit une build MV3 dans `output/chrome-mv3`.

```bash
npm install
npm run build
```

> NeetCode désactive les boutons **Run** et **Submit** tant qu'on n'est pas connecté à son compte.
> Sans connexion, l'extension n'a rien à détecter.

### Chrome, Edge, Brave (Windows, macOS, Linux)

1. ouvrir `chrome://extensions`, ou `edge://extensions` sur Edge ;
2. activer **Mode développeur**, en haut à droite ;
3. cliquer sur **Charger l'extension non empaquetée** ;
4. sélectionner le dossier **`output/chrome-mv3`** ;
5. ouvrir [neetcode.io](https://neetcode.io), se connecter, résoudre un problème.

L'icône verte apparaît dans la barre d'outils et le badge indique le nombre de révisions dues.

Firefox n'est pour l'instant pas supporté

### Safari (macOS)

Si c'est la première fois que vous utilisez Xcode, pensez à faire :

```bash
sudo xcodebuild -license accept
```

Puis, à la racine du projet :

```bash
npm run safari
```

Le script construit l'extension, la convertit en projet Xcode dans `output/safari`, la compile, et affiche le chemin de l'application produite. Ensuite, dans Safari :

1. ouvrir une fois l'application construite, par double-clic ;
2. Réglages, Avancé, cocher **Afficher les fonctionnalités pour développeurs web** ;
3. menu **Développement**, **Autoriser les extensions non signées**. À refaire à chaque
   redémarrage de Safari tant que l'application n'est pas signée avec un compte développeur Apple ;
4. Réglages, Extensions, activer **NeetCode Companion** ;
5. dans le même panneau, régler l'accès à `neetcode.io` sur **Toujours autoriser**.

## Développement

```bash
npm run dev        # rechargement à chaud dans un Chrome de développement
npm test           # suite Vitest
npm run compile    # typage strict, sans émission
npm run build      # build de production
npm run zip        # archive prête à publier
npm run safari     # build puis projet Xcode et application Safari
```

## Structure

```text
entrypoints/
  background.ts          service worker : routage des messages, badge, alarmes
  interceptor.ts          script injecté dans la page : patch de fetch et XHR
  neetcode.content.ts     content script : session, panneau, bandeau
  popup/ options/         interfaces
src/
  nc-endpoints.ts         détection des soumissions et des verdicts, fonctions pures
  nc-meta.ts              titre et difficulté, API puis repli DOM
  review.ts               fenêtre anti-doublon, calcul d'échéance, écriture
  fsrs.ts                 wrapper ts-fsrs, mapping ressenti vers grade
  storage.ts types.ts config.ts messaging.ts
  ui/panel.ts ui/banner.ts
tests/                    Vitest, dont fakeBrowser pour le storage
scripts/build-safari.sh   conversion et compilation Xcode
```

La logique de détection vit entièrement dans `src/nc-endpoints.ts`, en fonctions pures : c'est la
surface couverte par les tests, et les entrypoints ne font que du câblage.

## Comment la détection fonctionne

NeetCode est une application Angular et son `HttpClient` passe par `XMLHttpRequest`. Un content
script possède son propre `XMLHttpRequest` et ne verrait donc rien : l'intercepteur est injecté
dans le contexte de la page, où il surveille trois routes.

| Route                               | Interprétation                                       |
| ----------------------------------- | ---------------------------------------------------- |
| `POST /api/executeCodeFunctionHttp` | soumission d'un problème de code                     |
| `POST /api/runSqlFunctionHttp`      | soumission SQL si `runOnly: false`, sinon un « Run » |
| `POST /api/runCodeFunctionHttp`     | bouton « Run », jamais une soumission                |

Le verdict est lu dans `data.status.description`, et `"Accepted"` déclenche le panneau. Le slug du
problème vient de l'URL et jamais du corps de la requête : le champ `rawCode` n'est donc jamais lu.

Les métadonnées, titre et difficulté, viennent de `POST /api/getProblemMetadataFunctionHttp`, avec
un repli sur le `h1` et la pastille de difficulté de la page si l'appel échoue.

> Ces routes ne sont pas documentées par NeetCode. Si elles changent, tout se corrige dans
> `src/nc-endpoints.ts`, et les tests le signalent immédiatement.

## Notation et planification

| Réponse                  | Grade FSRS                |
| ------------------------ | ------------------------- |
| Avec aide, ou abandon    | Again                     |
| Seul, 4 « à l'arraché »  | Hard, ou Again au choix   |
| Seul, 3 « laborieux »    | Hard                      |
| Seul, 2 « correct »      | Good                      |
| Seul, 1 « fluide »       | Easy                      |
