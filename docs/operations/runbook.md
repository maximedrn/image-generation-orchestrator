# Runbook d'exploitation

## Démarrage

1. Fournir `PLATFORM_API_KEY`.
2. Monter le modèle dans `MODEL_DIRECTORY`.
3. Choisir un profil ou exécuter `./scripts/run-auto.sh -d`.
4. Attendre que `/health/ready` retourne `ready`.

## Readiness en échec

Vérifier dans cet ordre :

1. accès au volume durable ;
2. configuration YAML sélectionnée par `PLATFORM_CONFIG` ;
3. endpoint `/sdcpp/v1/capabilities` du moteur ;
4. modèle monté et lisible par le moteur ;
5. circuit breaker dans `/v1/engines`.

`/health/live` ne teste volontairement aucune dépendance externe et sert uniquement à détecter un processus mort.

## Queue qui monte

Consulter `/v1/metrics` et `/v1/engines`. Une queue croissante peut indiquer : moteur lent, modèle trop coûteux, circuit ouvert ou capacité globale trop faible. Augmenter la concurrence uniquement après mesure de la RAM/VRAM ; `maxRunningJobs` et `maxConcurrent` sont des garde-fous, pas des objectifs de saturation.

## Crash ou restart

Les jobs running possèdent une lease. À la reprise, le dispatcher récupère les leases expirés. Si un `remoteJobId` est déjà persisté, il reprend le polling de ce job et ne le remet pas en queue pour une panne de polling/DB/stockage. Sans identifiant distant, un retry est soumis uniquement tant que `attempt < maxAttempts`. Un worker qui ne peut plus renouveler son lease cesse ses appels upstream.

## Sauvegarde

Avec l'adaptateur par défaut, sauvegarder le volume `platform-data`, qui contient la base SQLite et les résultats. Pour une sauvegarde cohérente à chaud, utiliser une méthode SQLite compatible WAL ou arrêter proprement l'application avant copie du volume.

## Rotation de clé API

1. changer la variable d'environnement référencée par `security.apiKeyEnv` ;
2. redémarrer le service applicatif ;
3. ne jamais écrire la valeur dans le YAML, les logs ou les images Docker.

## Mise à jour d'un moteur

Le commit `stable-diffusion.cpp` est épinglé par `SDCPP_COMMIT` dans les Dockerfiles. Une mise à jour doit :

1. modifier le commit explicitement ;
2. reconstruire les quatre profils concernés ;
3. exécuter les tests de contrat du gateway ;
4. faire un smoke test avec un petit modèle/backend ;
5. confirmer les routes async/capabilities avant promotion.


## Première résolution des dépendances

Le dépôt reconstruit ne contient pas un lockfile copié de l’ancien graphe. Sur la première machine disposant de Bun `1.3.14` et de l’accès au registry :

```sh
bun install
bun run verify
git add bun.lock
git commit -m "chore: lock Bun dependencies"
```

À partir de ce commit, CI et release doivent remplacer `bun install` par `bun install --frozen-lockfile`.

## Incident entre soumission et binding

Si le moteur a accepté une génération mais que la base devient indisponible avant la persistance du `remoteJobId`, le worker réessaie le binding au lieu de resoumettre. Une interruption gracieuse déclenche une annulation upstream best-effort. Un hard crash dans cette fenêtre doit être traité comme une limite de protocole : sans clé d’idempotence côté moteur, l’absence de doublon ne peut pas être prouvée.


## Restauration

1. arrêter l’application afin qu’aucune écriture ne soit en cours ;
2. restaurer la base et les résultats depuis le même point de sauvegarde ;
3. vérifier les permissions du volume ;
4. redémarrer l’application ;
5. attendre `/health/ready` puis contrôler la récupération des leases expirés et les jobs `running`.

Ne restaurer que la base sans les résultats peut laisser des métadonnées pointant vers des fichiers absents.

## Purge des résultats

L’API publique ne supprime pas arbitrairement les artefacts historiques. Une politique de rétention doit être implémentée comme une opération d’administration explicite sur le port `ResultStorage`, jamais comme un `rm` concurrent au service. Avant d’automatiser une purge, définir la rétention métier et vérifier qu’aucun job référencé n’est encore servi.

## Saturation et capacité

Pour un test de charge, augmenter progressivement le trafic sans relever simultanément `maxRunningJobs`, `maxConcurrent` et les limites de coût. Observer queue, RSS, VRAM et latence moteur. La capacité de production est le dernier palier stable avant swap/OOM/throttling, avec une marge opérationnelle ; ce n’est pas la concurrence maximale acceptée par le runtime.
