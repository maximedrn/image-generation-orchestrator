# Stable Diffusion Platform

Plateforme d'inférence d'images asynchrone construite avec **NestJS + Fastify** pour la frontière HTTP, **Effect** pour le cœur applicatif et **Bun** comme runtime, gestionnaire de paquets, runner de tests et bundler.

Ce dépôt est la reconstruction complète du prototype initial arrêté au lot 2. Les lots moteur réel, dispatcher, multi-instance, sécurité, profils hardware et exploitation ont été intégrés dans une architecture où le métier ne dépend ni de SQLite, ni de `stable-diffusion.cpp`, ni du stockage local.

## Principes

- NestJS ne contient que les adaptateurs HTTP et le bootstrap.
- Le métier et l'orchestration utilisent Effect, des `Layer`, des services typés et des erreurs explicites.
- `JobRepository`, `EngineGateway` et `ResultStorage` sont des ports remplaçables.
- Aucun import relatif TypeScript ; les imports applicatifs passent par `@app/*` et les tests par `@test/*`.
- Les entrées externes sont décodées explicitement avec `Effect.Schema`.
- Les secrets ne sont jamais stockés dans le YAML.
- La queue est durable, bornée et récupérable après interruption.
- Les moteurs sont protégés par capacité, circuit breaker et backpressure globale.
- Les images sont écrites de façon atomique et servies en streaming.
- Les conteneurs tournent en non-root, lecture seule et sans capabilities Linux inutiles.

## État fonctionnel

La plateforme implémente désormais :

- `POST /v1/jobs` : admission, validation, rate limit et mise en queue durable ;
- `GET /v1/jobs/:id` : état durable et URLs de résultats ;
- `DELETE /v1/jobs/:id` : annulation queued/running ;
- `GET /v1/jobs/:id/results/:index` : streaming d'un résultat généré ;
- `GET /v1/engines` : état du scheduler et des moteurs ;
- `GET /v1/metrics` : métriques bornées de queue/moteurs ;
- `GET /health/live` et `GET /health/ready` ;
- dispatcher asynchrone `stable-diffusion.cpp` avec submit/poll/cancel ;
- reprise de jobs en cours via lease et `remoteJobId`, sans resoumission après binding durable ;
- scheduling least-loaded, concurrence multi-moteur et limite globale ;
- circuit breaker et récupération périodique des leases expirés ;
- profils Docker CPU, CUDA, ROCm et Vulkan ;
- mode moteur externe, notamment pour Metal/macOS ;
- image application Bun classique et option exécutable Linux MUSL.

## Prérequis

- Bun `1.3.14` ;
- Docker Engine et Docker Compose pour l'exécution conteneurisée ;
- un modèle compatible `stable-diffusion.cpp` monté dans `./models` pour l'inférence réelle.

Le projet a été reconstruit à partir du squelette NestJS correspondant à :

```sh
bunx @nestjs/cli@11.0.24 new stable-diffusion-platform \
  --package-manager npm \
  --strict \
  --skip-git \
  --skip-install
```

La commande est conservée sous `bun run nest:init` à titre de référence reproductible. Le `npm` passé à `--package-manager` ne sert qu'à satisfaire l'énumération du CLI Nest (qui n'accepte actuellement que npm/yarn/pnpm) ; `--skip-install` empêche toute installation. Bun est ensuite utilisé pour toutes les opérations du projet.

Le dépôt n'utilise volontairement ni `nest build` ni `nest start` : TypeScript 7 reste le compilateur de typecheck, tandis que Bun assure build/dev/runtime. Le Nest CLI reste cantonné au scaffolding, ce qui évite de dépendre de son Compiler API programmatique tant que sa compatibilité TypeScript 7 n'est pas finalisée. Les audits AST internes utilisent séparément `@typescript/typescript6` afin de ne pas contraindre le compilateur applicatif.

## Installation locale

```sh
bun install
cp .env.example .env
# renseigner PLATFORM_API_KEY dans .env ou dans l’environnement
cp config/platform.example.yaml config/platform.yaml
bun run verify
bun run dev
```

Avec `security.auth: bearer`, exporter la clé configurée :

```sh
export PLATFORM_API_KEY='replace-with-a-long-random-secret'
```

## Exemple API

```sh
curl -X POST http://localhost:3000/v1/jobs \
  -H "authorization: Bearer ${PLATFORM_API_KEY}" \
  -H 'content-type: application/json' \
  -d '{
    "cfgScale": 7,
    "count": 1,
    "height": 1024,
    "model": "default",
    "outputFormat": "png",
    "prompt": "a lighthouse in a storm",
    "steps": 30,
    "width": 1024
  }'
```

Le contrat n'applique pas de valeurs implicites cachées : les champs requis doivent être présents. `seed`, `negativePrompt` et `outputFormat` sont les seuls champs optionnels du contrat actuel.

## Docker : sélection automatique du backend

Préparer le secret et un modèle :

```sh
cp .env.example .env
mkdir -p models
# placer le modèle à l'emplacement correspondant à MODEL_FILE
./scripts/run-auto.sh -d
```

`run-auto.sh` sélectionne CUDA si `nvidia-smi` confirme un GPU NVIDIA visible, ROCm si `/dev/kfd` est présent, Vulkan si `/dev/dri` est présent, sinon CPU. Un `ENGINE_BACKEND=cpu|cuda|rocm|vulkan|external` explicite a toujours priorité sur l’auto-détection. Sur macOS, le conteneur applicatif utilise le profil externe : `sd-server` doit tourner sur l'hôte afin de bénéficier de Metal.

Lancement explicite :

```sh
docker compose --profile cpu up --build
docker compose --profile cuda up --build
docker compose --profile rocm up --build
docker compose --profile vulkan up --build
```

Les réglages mémoire du moteur sont configurables sans reconstruire l’image :

```sh
export SDCPP_VAE_TILING=true
export SDCPP_BACKEND_PLACEMENT='diffusion=cuda0,te=cpu,vae=cpu'
export SDCPP_PARAMS_BACKEND='cpu'
```

`SDCPP_VAE_TILING=true` est la valeur Docker par défaut pour réduire la pression VRAM du VAE ; le désactiver (`false`) peut être préférable lorsque la mémoire est abondante et que la latence prime. Les deux variables de placement restent vides par défaut afin de laisser `stable-diffusion.cpp` choisir son placement natif.

Pour l'exécutable applicatif MUSL :

```sh
docker compose -f compose.yaml -f compose.musl.yaml --profile cpu up --build
```

## Qualité

```sh
bun run format:check
bun run lint
bun run typecheck
bun run architecture:audit
bun run policy
bun test
bun run verify
```

`bun run verify` est la porte de sortie locale et CI. Les scripts d'audit contrôlent notamment les imports relatifs, les signatures explicites, les frontières d'adaptateurs, les tailles de fichiers/fonctions et la documentation TSDoc des éléments nommés.

## Garanties et limite distribuée

Le dispatcher distingue explicitement la phase pré-soumission de la phase remote-bound. Une fois `remoteJobId` persisté, une panne de polling/DB/stockage ne remet pas le job en queue et la récupération reprend le même travail distant. En cas d’interruption gracieuse avant le binding, le worker tente d’annuler le job distant.

Le protocole natif moteur ne fournit toutefois pas aujourd’hui de clé d’idempotence client documentée : un hard crash exactement entre l’acceptation distante et la persistance du `remoteJobId` ne permet pas de promettre un « exactly once » distribué absolu. Voir [Durabilité et sémantique de reprise](docs/architecture/durability.md).

Le terme multi-instance désigne ici plusieurs **moteurs d’inférence**. Plusieurs réplicas actifs de l’orchestrateur nécessiteraient en plus un fencing de lease, un repository partagé adapté et un rate limiter distribué ; cette topologie n’est pas annoncée comme supportée par défaut.

## Dépendances et versions

Les dépendances directes sont épinglées exactement dans `package.json`. Le lockfile doit être généré par la version Bun indiquée dans `.bun-version` lors de la première installation et commité dans le dépôt de travail réel. Un lockfile provenant de l'ancien prototype ne doit pas être réutilisé après une mise à niveau de dépendances.

## Architecture et exploitation

- [API HTTP](docs/api/http-api.md)
- [Architecture](docs/architecture/architecture.md)
- [Durabilité et sémantique de reprise](docs/architecture/durability.md)
- [Ajouter une base, un moteur ou un stockage](docs/architecture/extending.md)
- [Audit du projet d'origine](docs/architecture/original-audit.md)
- [Hardware et Docker](docs/operations/hardware.md)
- [Runbook d'exploitation](docs/operations/runbook.md)
- [Build Bun/MUSL](docs/operations/musl.md)
- [Validation et tests](docs/operations/testing.md)
- [Rapport de validation du refactor](docs/operations/validation-report.md)
- [Qualification des backends](docs/operations/backend-qualification.md)

Les documents historiques du prototype sont conservés sous `docs/legacy/` pour traçabilité ; ils ne décrivent pas l'état actuel du code.
