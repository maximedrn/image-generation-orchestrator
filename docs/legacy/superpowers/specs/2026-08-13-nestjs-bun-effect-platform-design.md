# Service Stable Diffusion simple — NestJS, Effect et Bun

- Date de révision : 14 août 2026
- Statut : architecture directrice révisée
- Portée : service API, queue durable, ordonnanceur, sécurité et exécution Stable Diffusion
- Remplace : l'architecture monorepo / NATS / Envoy / multi-applications décrite précédemment

## 1. Résumé

Le projet est un **service unique** TypeScript exécuté avec Bun.

Il contient :

- une API HTTP NestJS avec Fastify ;
- un cœur applicatif Effect ;
- une queue durable SQLite ;
- un ordonnanceur qui distribue les jobs vers une ou plusieurs instances `sd-server` de `stable-diffusion.cpp` ;
- un stockage local borné pour les entrées et résultats ;
- les protections d'overload, de sécurité et d'observabilité nécessaires à une mise en production simple.

Il n'y a **ni monorepo, ni microservices applicatifs, ni NATS, ni Redis, ni Envoy obligatoire, ni CLI séparée**.

Le même processus HTTP exécute aussi la boucle de dispatch. SQLite est la source de vérité des jobs ; Effect fournit le typage des erreurs, les ressources, la concurrence, les retries et les fibres de fond.

La plateforme doit rester utilisable avec un seul moteur CPU dans Docker, puis évoluer par configuration vers plusieurs moteurs GPU sans changer l'API publique.

## 2. Principes non négociables

1. Un seul `package.json` et un seul `bun.lock`.
2. Un seul service applicatif déployable : `app`.
3. Bun pour installer, lancer, tester et builder le TypeScript.
4. NestJS/Fastify uniquement comme adaptateur HTTP.
5. Effect pour la logique métier, les ressources, la concurrence et les erreurs.
6. `Effect.Schema` à toutes les frontières non fiables : HTTP, environnement, YAML/JSON, SQLite et réponses des moteurs.
7. Aucun `any` applicatif ; aucun cast double du type `as unknown as T`.
8. Queue durable dans SQLite ; aucune queue mémoire comme source de vérité.
9. Une limite dure de jobs acceptés et une limite dure de coût par job.
10. Une instance d'inférence n'est jamais exposée directement à Internet.
11. Les modèles sont référencés par identifiants déclaratifs ; aucune requête utilisateur ne fournit un chemin de fichier arbitraire.
12. Les versions de `stable-diffusion.cpp` sont épinglées et testées : son API évolue rapidement.

## 3. Ce que « tous types de hardware » signifie réellement

L'objectif est : **une même application et un même protocole moteur**, avec plusieurs profils d'exécution.

| Hôte | Exécution recommandée | Accélération | Statut |
| --- | --- | --- | --- |
| Linux x86_64 / arm64 sans GPU | Docker | CPU | support de base obligatoire |
| Linux + NVIDIA | Docker | CUDA | support production |
| Linux + AMD | Docker | ROCm si compatible, sinon Vulkan | support production après test matériel |
| Linux + Intel GPU | Docker | Vulkan / SYCL selon image validée | support conditionnel |
| Windows + NVIDIA | Docker Desktop / WSL2 | CUDA | support Docker |
| Windows + AMD / Intel | app en Docker + moteur natif | Vulkan/ROCm selon support | fallback réaliste |
| macOS Apple Silicon | app en Docker + moteur natif | Metal | voie optimisée |
| macOS Apple Silicon, tout en Docker | Docker | CPU uniquement | fonctionnel mais non optimisé GPU |

### 3.1 Limite macOS

Docker Desktop macOS n'offre pas de passthrough Metal générique aux conteneurs. La documentation ne doit donc jamais promettre une accélération Metal dans un conteneur Linux.

Sur Apple Silicon, la topologie recommandée est :

```text
Docker Desktop
┌────────────────────────────┐
│ app NestJS / Effect / Bun  │
│ SQLite + queue             │
└──────────────┬─────────────┘
               │ HTTP privé via host.docker.internal
               ▼
      sd-server natif macOS
             Metal
```

Cette exception ne change ni le contrat `EngineClient`, ni le scheduler.

## 4. Architecture cible

```text
Client
  |
  | HTTPS / réseau privé
  v
┌──────────────────────────────────────────────────────┐
│ app                                                  │
│ NestJS + Fastify                                     │
│                                                      │
│  HTTP -> Effect Schema -> JobService                 │
│                         |                            │
│                         v                            │
│                 SQLite JobRepository                 │
│                         |                            │
│                    Dispatcher                        │
│                  /      |      \                     │
│                 v       v       v                    │
│             Engine A Engine B Engine C               │
│             client   client   client                 │
└───────────────|────────|────────|─────────────────────┘
                |        |        |
                v        v        v
             sd-server sd-server sd-server
             CPU/CUDA  ROCm      Vulkan/Metal*

* Metal est généralement natif sur macOS.
```

### 4.1 Pourquoi ne pas utiliser NATS ou Redis

Ils ne sont pas nécessaires pour la cible : un service applicatif, une seule base de jobs et quelques moteurs d'inférence.

SQLite donne :

- durabilité après crash ;
- transactions atomiques pour l'admission et le claim des jobs ;
- installation nulle ;
- sauvegarde simple ;
- fonctionnement identique en local et en Docker.

Une migration vers PostgreSQL ou une file externe n'est envisagée que si l'application elle-même doit être répliquée horizontalement.

## 5. Arborescence

```text
.
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── http/
│   │   ├── jobs.controller.ts
│   │   ├── engines.controller.ts
│   │   ├── health.controller.ts
│   │   └── http-error.mapper.ts
│   ├── domain/
│   │   ├── job.ts
│   │   ├── engine.ts
│   │   └── errors.ts
│   ├── services/
│   │   ├── job.service.ts
│   │   ├── dispatcher.service.ts
│   │   ├── engine-pool.service.ts
│   │   └── storage.service.ts
│   ├── infra/
│   │   ├── config.ts
│   │   ├── db.ts
│   │   ├── job.repository.ts
│   │   ├── engine.client.ts
│   │   └── telemetry.ts
│   └── runtime/
│       ├── app.layer.ts
│       └── managed-runtime.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docker/
│   ├── app.Dockerfile
│   ├── sdcpp.cpu.Dockerfile
│   ├── sdcpp.cuda.Dockerfile
│   ├── sdcpp.rocm.Dockerfile
│   └── sdcpp.vulkan.Dockerfile
├── config/
│   └── platform.example.yaml
├── data/
│   └── .gitkeep
├── compose.yaml
├── package.json
├── bun.lock
├── tsconfig.json
├── biome.json
└── README.md
```

Pas de `apps/`, pas de `packages/`, pas de workspace Bun.

## 6. Modèle Effect

### 6.1 Frontière NestJS

Les contrôleurs NestJS sont minces :

1. recevoir `unknown` depuis HTTP ;
2. décoder avec `Effect.Schema` ;
3. appeler un service Effect via un `ManagedRuntime` unique ;
4. convertir les erreurs métier typées en réponses HTTP ;
5. ne contenir ni SQL, ni retry, ni ordonnanceur, ni logique de modèles.

### 6.2 Services Effect

Les services principaux sont exposés comme dépendances Effect :

- `Config` ;
- `JobRepository` ;
- `Storage` ;
- `EngineClient` ;
- `EnginePool` ;
- `Dispatcher` ;
- `Clock` / `Random` via Effect quand nécessaire.

Les erreurs de domaine sont des erreurs discriminées, par exemple :

```ts
type DomainError =
  | InvalidRequest
  | QueueFull
  | JobNotFound
  | JobNotCancellable
  | EngineUnavailable
  | EngineProtocolError
  | StorageError
  | PersistenceError
```

Aucun service métier ne lance une exception JavaScript pour un cas attendu.

## 7. Typage strict

Le `tsconfig.json` active au minimum :

- `strict` ;
- `noUncheckedIndexedAccess` ;
- `exactOptionalPropertyTypes` ;
- `noImplicitOverride` ;
- `noFallthroughCasesInSwitch` ;
- `useUnknownInCatchVariables` ;
- `noPropertyAccessFromIndexSignature`.

Règles de code :

- pas de `any` explicite ;
- pas de `@ts-ignore` ;
- `@ts-expect-error` uniquement dans un test qui prouve une contrainte de type ;
- pas de non-null assertion `!` hors interop isolé et commenté ;
- décoder toutes les données externes ;
- rendre exhaustifs les `switch` de statuts et d'erreurs.

## 8. Configuration

Un seul fichier YAML est monté en lecture seule, complété par quelques secrets d'environnement.

Exemple :

```yaml
server:
  host: 0.0.0.0
  port: 3000
  bodyLimitBytes: 12582912

security:
  auth: bearer
  apiKeyEnv: API_KEY
  trustProxy: false

queue:
  maxQueuedJobs: 100
  maxRunningJobs: 4
  maxAttempts: 2
  leaseSeconds: 120
  pollIntervalMs: 250

limits:
  maxWidth: 2048
  maxHeight: 2048
  maxPixels: 4194304
  maxSteps: 80
  maxBatch: 4
  maxInputBytes: 10485760
  maxJobCost: 300000000

storage:
  root: /data
  maxResultAgeHours: 168

models:
  sdxl:
    engineModel: sdxl
    maxWidth: 1536
    maxHeight: 1536
  flux-schnell:
    engineModel: flux-schnell
    maxWidth: 1536
    maxHeight: 1536

engines:
  - id: gpu-0
    url: http://sd-cuda-0:8080
    backend: cuda
    models: [sdxl, flux-schnell]
    maxConcurrent: 1
    requestTimeoutSeconds: 900

  - id: cpu-0
    url: http://sd-cpu-0:8080
    backend: cpu
    models: [sdxl]
    maxConcurrent: 1
    requestTimeoutSeconds: 1800
```

La configuration entière est décodée au démarrage. Une valeur inconnue ou invalide empêche le service de démarrer.

## 9. Contrat moteur

Le backend de référence est `sd-server` fourni par `stable-diffusion.cpp`.

Le client utilise de préférence l'API native asynchrone :

- `GET /sdcpp/v1/capabilities` ;
- `POST /sdcpp/v1/img_gen` ;
- `GET /sdcpp/v1/jobs/{id}` ;
- `POST /sdcpp/v1/jobs/{id}/cancel`.

L'implémentation doit isoler ce protocole dans `EngineClient`. Aucun contrôleur HTTP public ne dépend directement du JSON upstream.

### 9.1 Version épinglée

`stable-diffusion.cpp` indique lui-même que son API et ses options changent fréquemment. Chaque image moteur doit donc être construite depuis :

- un commit précis ;
- un hash d'image précis en production ;
- un test contractuel contre les endpoints utilisés.

Une mise à jour du moteur est une modification contrôlée, jamais un `latest` automatique.

### 9.2 Pas de queue cachée côté moteur

Même si `sd-server` accepte des jobs asynchrones, l'application ne lui soumet un nouveau job que si son slot local est libre.

Valeur par défaut :

```text
maxConcurrent = 1 par instance sd-server
```

On augmente cette valeur uniquement après benchmark mémoire et stabilité sur le matériel visé.

## 10. API publique

API native minimale :

```text
POST   /v1/jobs
GET    /v1/jobs/:id
DELETE /v1/jobs/:id
GET    /v1/jobs/:id/results/:index
GET    /v1/engines
GET    /health/live
GET    /health/ready
```

### 10.1 Création de job

Exemple conceptuel :

```json
{
  "model": "sdxl",
  "prompt": "a lighthouse in a storm",
  "negativePrompt": "low quality",
  "width": 1024,
  "height": 1024,
  "steps": 30,
  "cfgScale": 7,
  "seed": 42,
  "count": 1
}
```

Le serveur renvoie rapidement :

```json
{
  "id": "job_...",
  "status": "queued"
}
```

Le client ne garde pas une connexion HTTP ouverte pendant l'inférence.

### 10.2 Statuts

```text
queued -> running -> succeeded
   |         |          
   |         +-------> failed
   +-----------------> cancelled
```

Chaque transition est validée côté domaine et persistée atomiquement.

## 11. SQLite et durabilité

SQLite est ouvert en mode WAL avec foreign keys activées.

Tables minimales :

```text
jobs
  id
  status
  request_json
  cost
  created_at
  updated_at
  attempt
  engine_id nullable
  remote_job_id nullable
  lease_until nullable
  error_code nullable
  error_message nullable

results
  job_id
  index
  path
  mime_type
  size_bytes
  sha256
```

Les données JSON relues depuis SQLite sont re-décodées par `Effect.Schema`.

### 11.1 Claim atomique

Le dispatcher ne fait jamais : `SELECT` puis `UPDATE` dans deux opérations indépendantes.

Le claim d'un job est réalisé dans une transaction qui :

1. trouve le plus ancien job compatible ;
2. vérifie qu'un slot moteur est disponible ;
3. passe le job à `running` ;
4. assigne `engine_id` et une lease ;
5. incrémente l'attempt.

Un seul processus applicatif suffit pour v1, mais cette discipline évite déjà les races internes entre fibres.

## 12. Queue, backpressure et overload

La protection se fait à quatre niveaux.

### 12.1 Admission HTTP

Avant insertion :

- authentification valide ;
- schéma valide ;
- modèle autorisé ;
- dimensions, steps et batch bornés ;
- taille d'image d'entrée bornée ;
- coût calculé inférieur au maximum ;
- nombre de jobs `queued + running` inférieur à la capacité configurée.

Si la file est pleine :

```text
HTTP 429
code = QUEUE_FULL
Retry-After = valeur estimée et bornée
```

Il ne faut pas suspendre indéfiniment la requête HTTP en attendant une place.

### 12.2 Coût d'un job

Le coût sert à rejeter les demandes pathologiques avant allocation mémoire.

Formule simple v1 :

```text
cost = width * height * steps * count
```

Des multiplicateurs par modèle peuvent être ajoutés dans la configuration.

Le coût n'est pas un prédicteur parfait de temps GPU ; c'est une garde de sécurité stable et compréhensible.

### 12.3 Concurrence globale

`queue.maxRunningJobs` borne le nombre total de jobs actifs, même si la somme des slots moteurs est supérieure.

Le dispatcher utilise des primitives Effect bornées. Les fibres de polling et d'I/O ne doivent jamais être lancées en nombre non borné.

### 12.4 Protection de chaque moteur

Chaque moteur possède :

- `maxConcurrent` ;
- un compteur de jobs locaux ;
- un timeout ;
- un état `healthy | degraded | offline` ;
- un circuit breaker simple après échecs consécutifs ;
- un délai avant réintégration.

## 13. Scheduling multi-instance

Un moteur est candidat si :

1. il est sain ;
2. il supporte le modèle demandé ;
3. il possède un slot libre ;
4. le job respecte ses limites matérielles éventuelles.

Parmi les candidats, v1 choisit le moteur avec le plus faible ratio :

```text
running / maxConcurrent
```

En cas d'égalité, ordre stable par `id` ou round-robin.

Pas de scheduler prédictif complexe en v1.

### 13.1 Capacité déclarée et capacité observée

La configuration déclare le backend et les modèles attendus. Au démarrage puis périodiquement, l'application interroge le moteur et vérifie ses capacités.

Un moteur qui ne correspond pas à sa déclaration devient `degraded` et ne reçoit pas de nouveaux jobs.

## 14. Recovery et retries

Au redémarrage de l'application :

- les jobs `queued` restent `queued` ;
- les jobs `running` avec lease expirée sont examinés ;
- si `remote_job_id` existe et que le moteur répond, l'état distant est réconcilié ;
- sinon le job est remis en queue si `attempt < maxAttempts` ;
- sinon il passe à `failed` avec un code explicite.

Un retry conserve le seed résolu afin d'éviter une génération différente par accident.

Les retries automatiques ne s'appliquent qu'aux erreurs d'infrastructure, jamais aux requêtes invalides ou aux erreurs déterministes de modèle.

## 15. Annulation

`DELETE /v1/jobs/:id` :

- job `queued` : transition atomique vers `cancelled` ;
- job `running` : demande d'annulation au `sd-server`, puis état local ;
- job terminal : réponse idempotente avec l'état actuel.

L'annulation est best effort si le moteur ou le pilote ne répond plus.

## 16. Stockage

Le stockage v1 est local :

```text
/data/
  app.sqlite
  inputs/<job-id>/...
  results/<job-id>/000.png
```

Règles :

- noms générés par l'application ;
- aucune concaténation d'un chemin fourni par l'utilisateur ;
- écriture dans un fichier temporaire puis rename atomique ;
- hash SHA-256 persisté ;
- limite de taille avant et après décodage ;
- purge périodique des résultats expirés ;
- volume Docker dédié.

## 17. Sécurité

### 17.1 Exposition réseau

En production simple :

- seul `app` publie un port ;
- les `sd-server` sont sur un réseau Docker interne ;
- SQLite et les modèles ne sont jamais servis comme répertoires statiques ;
- l'API doit être placée derrière HTTPS ou un VPN si elle sort de localhost/LAN de confiance.

Pour un moteur natif macOS/Windows : l'écoute reste sur loopback ou sur un réseau privé explicitement filtré.

### 17.2 Authentification

V1 accepte une clé Bearer forte fournie par secret d'environnement.

Exigences :

- comparaison en temps constant ;
- aucune clé dans les logs ;
- aucun secret dans le YAML versionné ;
- réponse uniforme pour clé absente ou invalide.

Une auth multi-utilisateur/JWT/OIDC est hors périmètre tant qu'elle n'est pas nécessaire.

### 17.3 Entrées

Interdit par défaut :

- URL distante fournie par le client ;
- chemin de fichier ;
- nom de modèle non déclaré ;
- options arbitraires transmises telles quelles à `sd-server` ;
- arguments CLI injectés par requête ;
- prompt utilisé dans une commande shell.

Les prompts restent des données, jamais du code.

### 17.4 Limites HTTP

Configurer explicitement :

- taille maximale de body ;
- timeout headers/body ;
- nombre de connexions ;
- rate limit par clé/IP ;
- CORS désactivé par défaut ;
- pas de stack trace dans les erreurs publiques.

### 17.5 Conteneurs

Le conteneur `app` :

- utilisateur non-root ;
- filesystem read-only sauf `/data` et éventuel `/tmp` ;
- `no-new-privileges` ;
- capabilities Linux supprimées ;
- limites mémoire/CPU configurables ;
- image minimale et dépendances épinglées.

Les conteneurs GPU n'obtiennent que les devices nécessaires au backend.

## 18. Images moteur

Les images `stable-diffusion.cpp` partagent la même révision source, mais pas nécessairement la même toolchain.

### 18.1 CPU

Profil universel Linux, amd64/arm64. C'est la porte de compatibilité et le fallback de diagnostic.

### 18.2 CUDA

Build `SD_CUDA=ON`, runtime NVIDIA, device GPU explicitement réservé dans Compose.

### 18.3 ROCm

Build `SD_HIPBLAS=ON`. Le support dépend du GPU et de la version ROCm ; il doit être qualifié par une smoke generation réelle sur le matériel cible.

### 18.4 Vulkan

Build `SD_VULKAN=ON`. C'est le fallback GPU Linux le plus portable quand CUDA/ROCm ne conviennent pas. La compatibilité d'un modèle donné doit être testée ; "Vulkan disponible" ne signifie pas que chaque architecture de modèle aura la même qualité ou stabilité.

### 18.5 Metal

Build natif macOS `SD_METAL=ON`. Le service Docker communique avec ce moteur comme avec n'importe quelle autre instance HTTP.

## 19. Compose

Le Compose de base ne démarre que :

```text
app + un moteur CPU
```

Les GPU sont des profils optionnels :

```text
cpu
cuda
rocm
vulkan
external
```

`external` signifie qu'aucun moteur Docker n'est créé ; `config/platform.yaml` pointe vers un ou plusieurs `sd-server` déjà démarrés sur l'hôte ou le LAN privé.

On évite un Compose géant qui tente de détecter automatiquement tous les GPUs.

## 20. Observabilité

Minimum production :

### Logs structurés

Chaque log de job contient :

- `jobId` ;
- `engineId` si assigné ;
- `status` ;
- `durationMs` si terminal ;
- `errorCode` si échec.

Le prompt complet n'est pas loggé par défaut.

### Métriques

Au minimum :

- jobs queued/running/succeeded/failed/cancelled ;
- queue depth ;
- admission rejected ;
- durée de queue ;
- durée d'inférence ;
- moteurs healthy/degraded/offline ;
- erreurs moteur ;
- taille des résultats.

OpenTelemetry peut être ajouté sans introduire un service obligatoire dans Compose.

## 21. Health

`/health/live` vérifie uniquement que le processus et son runtime répondent.

`/health/ready` vérifie :

- SQLite accessible ;
- configuration chargée ;
- dispatcher démarré ;
- au moins un moteur sain si `requireEngineForReady = true`.

Un moteur indisponible ne doit pas tuer le processus applicatif.

## 22. Tests obligatoires

### Unitaires

- schémas ;
- transitions d'état ;
- calcul du coût ;
- sélection moteur ;
- mapping d'erreurs ;
- auth.

### Intégration SQLite

- admission atomique ;
- queue pleine ;
- claim concurrent ;
- lease expirée ;
- restart/recovery ;
- cancel queued/running.

### Contrat moteur

Contre la révision épinglée de `sd-server` :

- capabilities ;
- création d'un job ;
- polling jusqu'au succès ;
- récupération d'un résultat ;
- annulation ;
- erreur de modèle.

### Smoke hardware

Pour chaque image publiée :

1. démarrer le moteur ;
2. générer une petite image déterministe ;
3. vérifier un résultat non vide et décodable ;
4. collecter backend détecté, mémoire et durée ;
5. échouer si le backend demandé retombe silencieusement sur CPU.

## 23. CI

Ordre minimal :

```text
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun test
bun run test:integration
bun run build
```

Les builds GPU lourds peuvent être des jobs séparés ; la CI normale doit au minimum construire et tester `app` et le moteur CPU.

## 24. Hors périmètre v1

- monorepo ;
- Kubernetes ;
- NATS / Kafka / RabbitMQ / Redis ;
- réplication horizontale de `app` ;
- scheduler ML prédictif ;
- téléchargement libre de modèles depuis Internet ;
- extensions A1111 complètes ;
- UI d'administration ;
- multi-tenant billing ;
- entraînement/fine-tuning ;
- failover transparent d'un GPU en cours d'inférence.

## 25. Critères d'acceptation

La v1 est acceptée si :

1. le dépôt possède un seul package Bun ;
2. `bun run typecheck` passe en strict sans `any` applicatif ;
3. un job survit au redémarrage de l'application ;
4. une file pleine renvoie 429 sans bloquer le serveur ;
5. aucune instance moteur ne dépasse sa concurrence configurée ;
6. deux moteurs compatibles peuvent recevoir des jobs en parallèle ;
7. un moteur mort est sorti du pool sans rendre l'API indisponible ;
8. un job running est récupéré ou requeue après expiration de lease ;
9. les entrées hors limites sont rejetées avant soumission moteur ;
10. un moteur CPU Docker réalise une génération réelle ;
11. au moins un profil GPU Docker qualifié réalise une génération réelle sur CI/hardware dédié ;
12. Apple Silicon dispose d'un chemin documenté app Docker + moteur Metal natif ;
13. aucun `sd-server` n'est publié directement dans le Compose de production ;
14. les secrets et prompts ne sont pas présents dans les logs par défaut.

## 26. Références techniques

- Bun Runtime et compatibilité Node.js : documentation Bun officielle.
- `bun:sqlite` et mode WAL : documentation Bun officielle.
- Effect Queue et concurrence bornée : documentation Effect officielle.
- `stable-diffusion.cpp` : README, documentation de build et API `sd-server` officielles.
- Docker Compose GPU et Docker Desktop GPU : documentation Docker officielle.

Ces références doivent être revalidées lors d'une montée de version majeure de Bun, Effect, NestJS, Docker ou `stable-diffusion.cpp`.
