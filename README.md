# Companion

Extension Chrome/Chromium qui prolonge les workflows LeetCode et NeetCode avec :

- des révisions espacées planifiées par [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) ;
- une carte et une échéance communes lorsqu'un problème existe sur les deux plateformes ;
- un badge, un popup et un bandeau sur LeetCode comme sur NeetCode ;
- une synchronisation Supabase optionnelle et local-first du planning de révision ;
- une synchronisation GitHub optionnelle des nouvelles solutions Accepted **LeetCode**.

Le planning FSRS reste disponible localement et hors ligne. Lorsqu'un compte Supabase est connecté,
les cartes, le journal et les réglages sont aussi sauvegardés à distance. GitHub Sync est désactivé
par défaut et ne lit le code LeetCode qu'après son activation explicite. Le code NeetCode n'est
jamais extrait, stocké ou transmis par l'extension.

## Installation locale

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run build
```

Puis dans Chrome :

1. ouvrir `chrome://extensions` ;
2. activer le mode développeur ;
3. cliquer sur **Charger l'extension non empaquetée** ;
4. sélectionner `output/chrome-mv3/`.

Pour développer : `npm run dev`.

## Configuration Supabase

### 1. Créer la base

1. Créer un projet sur [Supabase](https://supabase.com/dashboard).
2. Dans **SQL Editor**, exécuter
   [`supabase/migrations/20260901000000_create_companion_snapshots.sql`](./supabase/migrations/20260901000000_create_companion_snapshots.sql)
   pour créer la table, les grants et les politiques RLS.
3. Dans **Project Settings → API**, relever l'URL du projet et la clé publishable.
4. Copier `.env.example` vers `.env.local`, puis renseigner ces deux valeurs :

```dotenv
WXT_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
WXT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

### 2. Configurer GitHub comme provider Supabase

Cette intégration d'authentification est distincte de la GitHub App utilisée pour enregistrer les
solutions. Elle utilise une **GitHub OAuth App** sans scope dépôt.

1. Dans Supabase, ouvrir **Authentication → Sign In / Providers → GitHub** et copier la Callback
   URL affichée. Elle ressemble à :

   ```text
   https://PROJECT_REF.supabase.co/auth/v1/callback
   ```

2. Dans [GitHub Developer settings → OAuth Apps](https://github.com/settings/developers), créer
   une nouvelle OAuth App :

   - **Application name** : `Companion Login` ;
   - **Homepage URL** : la page du projet ou du dépôt ;
   - **Authorization callback URL** : la Callback URL Supabase copiée à l'étape précédente ;
   - laisser **Device Flow** désactivé.

3. Copier le **Client ID** et générer un **Client secret** dans GitHub.
4. Revenir dans le provider GitHub de Supabase, activer le provider, renseigner ces deux valeurs et
   sauvegarder. Le Client secret reste exclusivement chez Supabase et ne doit jamais entrer dans
   `.env.local` ou dans l'extension.

### 3. Autoriser le retour vers l'extension Chrome

1. Construire puis recharger l'extension :

   ```bash
   npm run build
   ```

2. Ouvrir les réglages Companion et copier l'**URL de retour à autoriser dans Supabase**. Elle a
   cette forme :

   ```text
   https://EXTENSION_ID.chromiumapp.org/supabase
   ```

3. Dans Supabase, ouvrir **Authentication → URL Configuration → Redirect URLs**, ajouter cette URL
   exacte et sauvegarder.
4. Revenir dans Companion et cliquer sur **Continuer avec GitHub**.

L'identifiant d'une extension non empaquetée peut différer entre deux machines. Il faut alors
ajouter chaque URL de développement exacte. Une extension publiée possède un identifiant stable et
n'a besoin que de son URL de production.

La clé `service_role` ne doit jamais être placée dans l'extension. La clé publishable est publique ;
l'isolation des données est assurée dans PostgreSQL par les politiques RLS de la migration.

Le login Supabase ne demande aucun scope `repo` GitHub. Le token provider reçu pendant OAuth est
retiré de la session persistée après l'échange PKCE ; seules les clés de session Supabase restent
stockées localement.

### Migration et fonctionnement local-first

Au premier login GitHub, Companion fusionne le snapshot distant et les données déjà présentes dans
`chrome.storage.local`. Si le compte distant est vide, l'état local complet y est envoyé. Les
cartes en conflit sont choisies selon leur `updatedAt`, leurs sources LeetCode/NeetCode sont réunies
et les entrées de journal identiques sont dédupliquées.

Chaque mutation FSRS est enregistrée localement avant toute requête réseau. Une synchronisation est
tentée immédiatement, puis toutes les cinq minutes si le réseau était indisponible. Se déconnecter
de Supabase conserve les données locales. Pour éviter une fuite entre comptes, un profil local déjà
lié ne peut pas être envoyé vers un autre utilisateur Supabase.

Le snapshot Supabase ne reçoit jamais les tokens de la GitHub App utilisée par GitHub Sync, la file
de commits ni le code d'une solution. Ces clés restent dans des espaces séparés de
`chrome.storage.local`. Le bref échange de token nécessaire au login GitHub est traité séparément
par Supabase Auth.

## Révisions FSRS sur les deux plateformes

Après une vraie soumission Accepted, un panneau demande comment le problème a été résolu et sa
difficulté ressentie. Les boutons « Run » sont ignorés sur les deux sites. Sur NeetCode, la
détection réseau principale est complétée par un fallback DOM borné et corrélé à une vraie
soumission.

Le popup permet aussi de reprendre un Accepted fermé sans notation, d'abandonner une révision et
d'exporter les cartes et le journal au format JSON. Une révision s'ouvre sur LeetCode lorsqu'une
source LeetCode est connue, sinon sur NeetCode. Le bandeau présent sur chaque site privilégie la
source du site courant.

Lorsqu'un problème LeetCode est ouvert depuis Companion, l'éditeur retrouve automatiquement le
code initial : la classe et la signature de fonction restent en place, tandis que l'ancienne
solution est retirée. Les visites ordinaires et les ouvertures NeetCode ne modifient jamais
l'éditeur.

### Une seule carte pour LeetCode et NeetCode

Les slugs peuvent différer (`duplicate-integer` sur NeetCode et `contains-duplicate` sur LeetCode).
Companion rapproche les problèmes à l'aide d'alias connus, des identifiants déjà observés et d'une
comparaison conservatrice des titres. La carte commune conserve les deux sources et un seul état
FSRS. Le cooldown anti-doublon s'applique séparément sur chaque plateforme.

Les données existantes de la version LeetCode-only sont migrées automatiquement au premier
démarrage. Cette migration ne modifie ni l'authentification, ni le dépôt, ni la file GitHub.

## GitHub Sync — LeetCode uniquement

Une fois activée, chaque nouvelle soumission Accepted LeetCode met à jour par exemple :

```text
top-interview-150/
  0027-remove-element/
    solution.cpp
```

Lorsqu'un exercice est soumis depuis un Study Plan ou une liste LeetCode, son `envId` est utilisé
comme dossier racine (`top-interview-150`, par exemple). Sans contexte détectable, l'extension
utilise `solutions/`.

Le fichier contient le code et un en-tête commenté avec le lien LeetCode, la date, le langage, le
runtime, la mémoire et leurs « Beats » lorsqu'ils sont fournis. Une nouvelle soumission du même
problème dans le même langage remplace ce fichier ; l'historique reste disponible dans les commits
Git.

La synchronisation :

- ne concerne que les Accepted LeetCode effectués après l'activation ;
- confirme chaque upload réussi dans LeetCode avec un lien direct vers le fichier GitHub ;
- conserve les échecs GitHub dans une file locale et réessaie toutes les 15 minutes ;
- renouvelle automatiquement les tokens GitHub expirables ;
- n'expose jamais le token GitHub au code des pages LeetCode ou NeetCode ;
- exclut credentials et code en attente de l'export FSRS ;
- supprime token et file locale lorsque GitHub est déconnecté.

### GitHub App officielle

Le build contient le Client ID public et le slug de la
[GitHub App LeetCode Companion](https://github.com/apps/leetcode-companion-aminbelfkira).
Aucune variable d'environnement ni configuration manuelle n'est nécessaire.

La GitHub App utilise le Device Flow, n'a pas de webhook et demande uniquement la permission dépôt
**Contents: Read and write**. Aucun `client_secret` ni aucune clé privée n'est embarqué dans
l'extension.

L'utilisateur ouvre **GitHub Sync** depuis le popup, installe l'app sur un dépôt précis, saisit le
code GitHub et sélectionne ce dépôt.

## Vérifications

```bash
npm test
npm run compile
npm run build
```

Les endpoints LeetCode et NeetCode utilisés pour détecter les soumissions ne sont pas documentés
publiquement et peuvent évoluer. Leur logique est isolée dans `src/lc-endpoints.ts` et
`src/nc-endpoints.ts`.

## Confidentialité

Voir [PRIVACY.md](./PRIVACY.md).
