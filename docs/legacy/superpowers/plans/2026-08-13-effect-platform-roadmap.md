# Roadmap d'implémentation — Stable Diffusion simple avec NestJS, Effect et Bun

> **Pour les agents Superpowers :** implémenter lot par lot. Chaque lot doit être testable et utilisable avant de passer au suivant. Ne pas créer de worktree ou de package supplémentaire pour « préparer la suite ».

**Architecture de référence :** `docs/superpowers/specs/2026-08-13-nestjs-bun-effect-platform-design.md`.

## 1. Règles du programme

- Un seul dépôt, un seul `package.json`, un seul `bun.lock`.
- Aucun monorepo, workspace ou package interne.
- Une seule application NestJS/Fastify exécutée par Bun.
- Effect porte le domaine et l'infrastructure applicative.
- SQLite est la queue durable et la persistance des jobs.
- `stable-diffusion.cpp` est toujours derrière `EngineClient`.
- Les moteurs sont configurés, jamais découverts par magie.
- Commencer par CPU ; ajouter les backends GPU après une génération réelle validée.
- Ne pas ajouter Redis, NATS, Envoy, Kubernetes ou PostgreSQL sans besoin démontré.
- Toute donnée externe est décodée avec `Effect.Schema`.
- Toute limite de charge importante possède un test de rejet.

## 2. Dépendances entre lots

```text
Lot 1 — Fondation typée
   |
   v
Lot 2 — Jobs + SQLite + overload
   |
   v
Lot 3 — Moteur réel + dispatcher
   |
   v
Lot 4 — Multi-instance + sécurité production
   |
   v
Lot 5 — Hardware Docker + release
```

Le passage au lot suivant est interdit si la définition de fin du lot courant n'est pas satisfaite.

## Lot 1 — Fondation Bun, NestJS et Effect

### But

Obtenir un service unique, strictement typé, qui démarre, valide sa configuration et expose les endpoints de santé sans dépendre d'un moteur Stable Diffusion.

### Livrables

- `package.json`, `bun.lock`, `tsconfig.json`, Biome ;
- NestJS + Fastify ;
- `ManagedRuntime` Effect unique ;
- `Effect.Schema` pour la configuration ;
- layers `Config`, `Database`, `Telemetry` ;
- SQLite initialisée en WAL ;
- `/health/live` et `/health/ready` ;
- Dockerfile de l'application ;
- tests unitaires et intégration de démarrage.

### Porte de sortie

```text
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

Le conteneur `app` démarre non-root avec une base SQLite sur volume.

Détail : `docs/superpowers/plans/2026-08-13-lot-01-bun-effect-foundation.md`.

## Lot 2 — Jobs durables et overload

### But

Créer l'API asynchrone sans encore lancer d'inférence réelle.

### Travail

- schémas `JobRequest`, `Job`, `JobStatus`, `PublicError` ;
- migrations SQLite minimales ;
- `JobRepository` ;
- transitions d'état exhaustives ;
- `POST /v1/jobs` ;
- `GET /v1/jobs/:id` ;
- `DELETE /v1/jobs/:id` ;
- calcul du coût ;
- limite `maxQueuedJobs` ;
- rejet 429 `QUEUE_FULL` ;
- rate limit local simple ;
- stockage borné des inputs ;
- tests de concurrence du claim et de l'admission.

### Porte de sortie

- un job `queued` survit à un restart ;
- 100 requêtes concurrentes ne dépassent jamais la capacité configurée ;
- une requête trop grande est rejetée avant écriture de gros fichiers ;
- aucun chemin/URL externe arbitraire n'est accepté.

## Lot 3 — `sd-server` réel et dispatcher

### But

Générer réellement une image avec un moteur CPU épinglé.

### Travail

- image `stable-diffusion.cpp` CPU à commit fixé ;
- `EngineClient` typé ;
- decode des réponses upstream ;
- health/capabilities ;
- dispatcher Effect ;
- `maxConcurrent = 1` ;
- création/polling/cancel upstream ;
- persistance de `engine_id`, `remote_job_id`, lease et attempt ;
- récupération atomique des résultats ;
- recovery des jobs running ;
- timeouts et retries d'infrastructure ;
- test contractuel `sd-server` ;
- smoke generation CPU dans Docker.

### Porte de sortie

Une requête publique complète doit faire :

```text
POST job -> queued -> running -> succeeded -> GET result
```

et continuer à fonctionner après un redémarrage de `app` au milieu du parcours.

## Lot 4 — Multi-instance, backpressure et sécurité production

### But

Supporter plusieurs moteurs et des pannes partielles sans complexifier le déploiement.

### Travail

- plusieurs entrées `engines[]` ;
- filtre par modèle/capacité ;
- scheduling least-loaded ;
- limite globale `maxRunningJobs` ;
- slots par moteur ;
- circuit breaker simple ;
- moteur `offline` sans crash application ;
- bearer auth ;
- comparaison de clé en temps constant ;
- body limits ;
- timeouts ;
- CORS off par défaut ;
- logs structurés avec redaction ;
- résultats protégés par auth ;
- réseau Docker interne ;
- conteneur `app` read-only/non-root/no-new-privileges.

### Porte de sortie

- deux faux moteurs puis deux moteurs réels peuvent travailler en parallèle ;
- jamais plus de jobs actifs qu'autorisé ;
- un moteur tué pendant un job déclenche recovery ou échec typé ;
- la queue pleine reste réactive ;
- `sd-server` n'a aucun port public dans Compose production.

## Lot 5 — Profils hardware et release

### But

Fournir les chemins d'exécution réellement supportés sans prétendre à une portabilité GPU inexistante.

### Travail

- Dockerfile CPU multi-arch ;
- Dockerfile CUDA ;
- Dockerfile ROCm ;
- Dockerfile Vulkan ;
- profils Compose ;
- documentation Windows NVIDIA/WSL2 ;
- documentation Linux AMD/ROCm et fallback Vulkan ;
- documentation Intel/Vulkan si qualifiée ;
- documentation Apple Silicon : `app` Docker + `sd-server` Metal natif ;
- mode `external` pour moteurs natifs ou distants privés ;
- smoke test par backend réellement disponible ;
- matrice de compatibilité modèle/backend issue de mesures ;
- procédure de bump de `stable-diffusion.cpp` avec tests contractuels ;
- sauvegarde/restauration de `/data` ;
- purge et runbook saturation.

### Porte de sortie

Chaque backend annoncé comme supporté doit posséder une preuve de génération réelle sur le matériel concerné. Un backend non qualifié est documenté comme expérimental ou non supporté, jamais comme « probablement compatible ».

## 3. Règle de simplicité

Avant d'ajouter un composant d'infrastructure, répondre à ces questions :

1. Quel problème mesuré résout-il aujourd'hui ?
2. Pourquoi SQLite + Effect + plusieurs `sd-server` ne suffisent-ils plus ?
3. Quel test prouve le problème ?
4. Quel coût opérationnel le nouveau composant ajoute-t-il ?

Sans réponse concrète, ne pas l'ajouter.

## 4. Évolutions possibles après v1

Uniquement si la charge l'exige :

- PostgreSQL pour plusieurs replicas `app` ;
- object storage S3 pour plusieurs hôtes ;
- OIDC/JWT multi-utilisateur ;
- métriques OpenTelemetry exportées ;
- priorité ou quotas par tenant ;
- moteur alternatif derrière le même `EngineClient`.

Ces évolutions ne doivent pas être scaffoldées dans v1.
