# LeetCode Companion

Extension Chrome qui prolonge le workflow LeetCode avec :

- des révisions espacées planifiées par [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) ;
- un badge et une file de problèmes dus ;
- une synchronisation GitHub optionnelle des nouvelles solutions Accepted.

Le fonctionnement FSRS est local, sans compte ni serveur. GitHub Sync est désactivé par défaut et
ne lit le code qu'après son activation explicite.

## Installation locale

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

## Révisions FSRS

Après une vraie soumission Accepted, un panneau demande comment le problème a été résolu et sa
difficulté ressentie. Le badge, le popup et le bandeau LeetCode remontent ensuite les problèmes dus.
Le bouton « Run » n'est pas interprété comme une soumission.

Le popup permet également de reprendre un Accepted fermé sans notation, d'abandonner une révision
et d'exporter les cartes et le journal au format JSON.

Lorsqu'un problème dû est ouvert depuis le popup ou le bandeau Companion, l'éditeur retrouve
automatiquement le code initial de LeetCode : la classe et la signature de fonction restent en
place, tandis que l'ancienne solution est retirée. Les visites ordinaires ne modifient jamais le
contenu de l'éditeur.

## GitHub Sync

Une fois activée, chaque nouvelle soumission Accepted met à jour :

```text
top-interview-150/
  0027-remove-element/
    solution.cpp
```

Lorsqu'un exercice est soumis depuis un Study Plan ou une liste LeetCode, son `envId` est utilisé
comme dossier racine (`top-interview-150`, par exemple). Sans contexte détectable, l'extension
utilise `solutions/` comme dossier de repli.

Le fichier contient le code et un en-tête commenté avec le lien LeetCode, la date, le langage, le
runtime, la mémoire et leurs « Beats » lorsqu'ils sont fournis par LeetCode. Une nouvelle soumission
du même problème dans le même langage remplace ce fichier ; l'historique reste disponible dans les
commits Git.

La synchronisation :

- ne concerne que les Accepted effectués après l'activation ;
- confirme chaque upload réussi dans LeetCode avec un accès direct au fichier GitHub ;
- conserve les échecs réseau dans une file locale et réessaie toutes les 15 minutes ;
- renouvelle automatiquement les tokens GitHub expirables sans nouvelle action de l'utilisateur ;
- n'expose jamais le token GitHub au code de la page LeetCode ;
- exclut credentials et code en attente de l'export FSRS ;
- supprime token et file locale lorsque GitHub est déconnecté.

### GitHub App officielle

Le build contient déjà le Client ID public et le slug de la
[GitHub App LeetCode Companion](https://github.com/apps/leetcode-companion-aminbelfkira).
Aucune variable d'environnement ni configuration manuelle n'est nécessaire, y compris pour un
build local.

La GitHub App utilise le Device Flow, n'a pas de webhook et ne demande que la permission dépôt
**Contents: Read and write**. Les tokens expirables sont renouvelés localement via le Device Flow.
Aucun `client_secret` ni aucune clé privée n'est embarqué dans l'extension.

L'utilisateur ouvre ensuite **GitHub Sync** depuis le popup, installe l'app sur un dépôt précis,
saisit le code GitHub et sélectionne ce dépôt. Cette activation n'est faite qu'une fois.

## Vérifications

```bash
npm test
npm run compile
npm run build
```

## Confidentialité

Voir [PRIVACY.md](./PRIVACY.md).
