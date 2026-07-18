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

## GitHub Sync

Une fois activée, chaque nouvelle soumission Accepted met à jour :

```text
solutions/
  0027-remove-element/
    solution.cpp
```

Le fichier contient le code et un en-tête commenté avec le lien LeetCode, la date, le langage, le
runtime, la mémoire et leurs « Beats » lorsqu'ils sont fournis par LeetCode. Une nouvelle soumission
du même problème dans le même langage remplace ce fichier ; l'historique reste disponible dans les
commits Git.

La synchronisation :

- ne concerne que les Accepted effectués après l'activation ;
- conserve les échecs réseau dans une file locale et réessaie toutes les 15 minutes ;
- n'expose jamais le token GitHub au code de la page LeetCode ;
- exclut credentials et code en attente de l'export FSRS ;
- supprime token et file locale lorsque GitHub est déconnecté.

### Configurer la GitHub App pour un build

Le build utilise le Device Flow d'une GitHub App : aucun `client_secret` ne doit être embarqué.

1. Créer une GitHub App dans **Settings → Developer settings → GitHub Apps**.
2. Désactiver les webhooks et activer **Device Flow**.
3. Accorder uniquement la permission dépôt **Contents: Read and write**.
4. Pour un usage sans reconnexion fréquente, laisser l'expiration des user-to-server tokens
   désactivée.
5. Copier `.env.example` vers `.env.local`, puis renseigner le Client ID public et le slug de l'app.
6. Relancer `npm run build` et recharger l'extension.

```dotenv
WXT_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
WXT_GITHUB_APP_SLUG=leetcode-companion
```

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
