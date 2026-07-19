# Politique de confidentialité — LeetCode Companion

Dernière mise à jour : 19 juillet 2026.

## Fonctionnement local

LeetCode Companion ne possède aucun serveur, ne contient aucun système d'analytics et ne vend,
partage ou collecte aucune donnée. Les cartes FSRS, réglages et journaux de révision sont conservés
dans `chrome.storage.local` sur l'appareil de l'utilisateur.

Lorsque GitHub Sync est désactivé, le code soumis sur LeetCode n'est ni lu ni stocké par
l'extension.

## GitHub Sync optionnelle

GitHub Sync doit être activée explicitement. Après cette activation, et seulement après une
soumission Accepted, l'extension demande à LeetCode le détail de cette soumission : code, langage,
runtime, mémoire et percentiles disponibles. Ces informations sont envoyées directement depuis
l'extension vers l'API GitHub afin de mettre à jour le dépôt choisi par l'utilisateur.

Aucun code ni token ne transite par un serveur LeetCode Companion. Les tokens GitHub d'accès et de
renouvellement, le dépôt choisi et les éventuels commits en attente sont conservés localement. Les
tokens sont renouvelés directement auprès de GitHub, ne sont jamais injectés dans la page LeetCode
et ne sont pas inclus dans l'export JSON des données FSRS.

La déconnexion GitHub supprime les tokens et la file de synchronisation locale. Les commits déjà
créés dans le dépôt GitHub ne sont pas supprimés.

## Services contactés

- `leetcode.com` : détection des Accepted et récupération du détail de la soumission ;
- `github.com` : autorisation Device Flow lorsque GitHub Sync est activée ;
- `api.github.com` : sélection du dépôt et mise à jour du fichier de solution.

Le traitement effectué par LeetCode et GitHub reste soumis à leurs propres politiques de
confidentialité.

## Permissions

- `storage` : données FSRS, configuration GitHub et file de retry locale ;
- `alarms` : badge FSRS et nouvelle tentative GitHub ;
- accès à `leetcode.com` : intégration dans le workflow LeetCode ;
- accès optionnel à `github.com` et `api.github.com` : demandé uniquement lors de l'activation de
  GitHub Sync.
