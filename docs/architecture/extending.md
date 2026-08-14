# Étendre l'infrastructure

## Règle

Une nouvelle intégration doit implémenter un port existant ou ajouter un adaptateur dédié. Le domaine ne doit jamais importer un SDK de base de données, un DTO moteur ou une API de stockage objet.

## PostgreSQL ou MySQL

Le contrat à implémenter est `JobRepositoryShape` dans `src/job/job-repository.interface.ts`.

L'adaptateur doit préserver les invariants suivants :

- insertion bornée de la queue dans une transaction ;
- claim atomique d'un job queued ;
- respect atomique de `maxRunningJobs` ;
- renouvellement de lease ;
- transitions d'état conditionnelles ;
- persistance de `remoteJobId` avant reprise ;
- résultats uniques par `(jobId, index)` ;
- récupération des jobs running dont le lease a expiré.

Créer par exemple :

```text
src/job/postgres-job-repository.service.ts
src/job/postgres-job-repository.helpers.ts
src/job/postgres-job-repository.types.ts
```

Puis fournir un `Layer<JobRepository, DatabaseError>` dans `createAppRuntime(config, { jobRepository })`. Le dispatcher et les controllers restent inchangés.

## ComfyUI ou autre moteur

Le contrat à implémenter est `EngineGatewayShape` dans `src/engine/engine.interface.ts`.

Le port est provider-neutral :

- `capabilities(engine)` ;
- `submit(engine, request)` ;
- `poll(engine, remoteJobId)` ;
- `cancel(engine, remoteJobId)`.

Les DTOs ComfyUI doivent rester dans des fichiers dédiés, par exemple :

```text
src/engine/comfyui.types.ts
src/engine/comfyui.constants.ts
src/engine/comfyui.helpers.ts
src/engine/comfyui.service.ts
```

Le mapping convertit les statuts/outputs natifs vers `EngineJob`, `EngineSubmission` et `EngineCapabilities`. Ajouter ensuite le provider dans la configuration et enregistrer son adapter dans le router de gateway. Aucun type ComfyUI ne doit remonter dans le dispatcher.

## S3, MinIO ou stockage objet

Implémenter `ResultStorageShape` dans `src/storage/storage.interface.ts` avec les mêmes propriétés : persistance atomique ou transactionnelle, hash, taille, MIME type et lecture streamée.

Le repository ne stocke que la métadonnée renvoyée par le port. Le controller reste indépendant du backend de stockage.

## Réplication horizontale de l’orchestrateur

Changer SQLite pour PostgreSQL/MySQL ne suffit pas à rendre plusieurs processus `app` actifs/actifs corrects. Avant d’annoncer cette topologie comme supportée, étendre `JobRepositoryShape` avec un token/génération de lease servant de fencing à `renewLease` et aux transitions terminales, puis ajouter des tests de concurrence inter-worker.

Le repository partagé doit garantir qu’un worker ayant perdu sa propriété durable ne peut plus renouveler ou terminer le job.

## Rate limit distribué

Le rate limiter actuel est volontairement local et borné en mémoire. Pour plusieurs réplicas HTTP indépendants nécessitant une limite globale, introduire un port de rate limit distribué et une implémentation Redis/Valkey. Cela ne doit pas modifier `JobRepository` : admission durable et rate limiting sont deux responsabilités différentes.

## Règles d'adaptateur

- pas d'import de DTO d'adaptateur hors de son module ;
- décodage de chaque réponse externe avant usage ;
- erreurs réseau/protocole explicites ;
- timeouts configurés ;
- aucune valeur secrète dans les logs ;
- tests de contrat avec un faux serveur ou des fixtures décodées ;
- Layer injectable depuis `RuntimeAdapterLayers` lorsque l'adaptateur remplace une dépendance structurante.
