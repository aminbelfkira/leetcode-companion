# Politique de confidentialité — Companion

Dernière mise à jour : 1er septembre 2026.

## Données de révision et Supabase

Companion ne contient aucun système d'analytics et ne vend pas de données. Les cartes FSRS, sources
LeetCode/NeetCode, réglages et journaux de révision sont toujours conservés dans
`chrome.storage.local` sur l'appareil de l'utilisateur afin de fonctionner hors ligne.

Si l'utilisateur connecte explicitement Supabase avec GitHub, ces données de révision sont également
envoyées au projet Supabase configuré par l'éditeur de l'extension. Elles sont stockées dans un
snapshot JSON associé à l'identifiant du compte. Les politiques Row Level Security limitent la
lecture et l'écriture à cet utilisateur. GitHub et Supabase Auth traitent l'identité GitHub et
l'adresse email éventuellement associée ; aucun mot de passe GitHub n'est vu par l'extension. La
session Supabase est conservée localement pour maintenir la connexion.

Le login utilise OAuth avec PKCE et ne demande aucun scope dépôt GitHub. Le token d'accès du
provider GitHub éventuellement retourné par Supabase est retiré de la session persistée dès la fin
du login. Il n'est ni utilisé pour GitHub Sync, ni envoyé dans le snapshot de révision.

La synchronisation Supabase est local-first : une panne réseau n'empêche pas l'enregistrement d'une
révision. La déconnexion conserve les données FSRS locales et supprime la session Supabase locale ;
elle ne supprime pas automatiquement le snapshot distant.

Sur NeetCode, l'extension observe le départ d'une soumission et son verdict. Pour distinguer « Run »
de « Submit » sur les problèmes SQL, elle inspecte uniquement le drapeau `runOnly` du corps JSON ;
le champ de code `rawCode` n'est jamais extrait, conservé, journalisé ou transmis.

Lorsque GitHub Sync est désactivé, le code soumis sur LeetCode n'est ni demandé ni stocké par
l'extension.

## GitHub Sync optionnelle, limitée à LeetCode

GitHub Sync doit être activée explicitement. Après cette activation, et seulement après une
soumission Accepted LeetCode, l'extension demande à LeetCode le détail de cette soumission : code,
langage, runtime, mémoire et percentiles disponibles. Ces informations sont envoyées directement
depuis l'extension vers l'API GitHub afin de mettre à jour le dépôt choisi par l'utilisateur.

GitHub Sync ne lit et n'envoie jamais le code NeetCode.

Le snapshot de révision Supabase ne contient aucun code ni token de la GitHub App utilisée par
GitHub Sync. Ces tokens GitHub d'accès et de renouvellement, le dépôt choisi et les éventuels
commits en attente sont conservés localement. Le token provider distinct utilisé pendant le login
GitHub est traité par Supabase Auth puis retiré de la session persistée par Companion. Les
tokens sont renouvelés directement auprès de GitHub, ne sont jamais injectés dans une page web et
ne sont pas inclus dans l'export JSON des données FSRS.

La déconnexion GitHub supprime les tokens et la file de synchronisation locale. Les commits déjà
créés dans le dépôt GitHub ne sont pas supprimés.

## Services contactés

- `leetcode.com` : détection des Accepted, métadonnées et, si GitHub Sync est actif, détail de la
  soumission ;
- `neetcode.io` : détection des Accepted et métadonnées du problème ;
- le projet `supabase.co` configuré dans le build : authentification et synchronisation optionnelle
  des seules données de révision ;
- `github.com` : authentification Supabase avec GitHub et autorisation Device Flow séparée lorsque
  GitHub Sync est activée ;
- `api.github.com` : sélection du dépôt et mise à jour du fichier de solution.

Le traitement effectué par LeetCode, NeetCode, Supabase et GitHub reste soumis à leurs propres
politiques de confidentialité.

## Permissions

- `storage` : données FSRS, session Supabase, configuration GitHub et files de retry locales ;
- `alarms` : badge FSRS et nouvelles tentatives Supabase/GitHub ;
- `identity` : ouverture du login GitHub OAuth et capture du retour sécurisé destiné à l'extension ;
- accès à `leetcode.com` et `neetcode.io` : intégration dans les workflows de résolution ;
- accès au domaine Supabase du projet : inclus uniquement dans les builds où Supabase est configuré ;
- accès optionnel à `github.com` et `api.github.com` : demandé uniquement lors de l'activation de
  GitHub Sync.
