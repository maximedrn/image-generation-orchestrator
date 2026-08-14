# Lot 1 — Fondation Bun, NestJS et Effect

> **Pour les agents Superpowers :** utiliser un développement task-by-task. Cocher les étapes seulement après exécution des vérifications associées. Ne pas créer de worktree, monorepo, package interne ou service secondaire.

**Goal:** Créer une application unique Bun + NestJS/Fastify + Effect, strictement typée, avec configuration décodée, SQLite durable et endpoints de santé.

**Architecture:** NestJS ne fait que l'adaptation HTTP. Un `ManagedRuntime` Effect construit toutes les dépendances applicatives. SQLite est ouvert par un Layer scoped. Aucun job Stable Diffusion réel n'est exécuté dans ce lot.

**Spec:** `docs/superpowers/specs/2026-08-13-nestjs-bun-effect-platform-design.md`.

## 1. Contraintes

- un seul `package.json` ;
- un seul `src/` ;
- Bun comme runtime/package manager/test runner ;
- NestJS + Fastify ;
- Effect + `Effect.Schema` ;
- SQLite via API Bun ;
- Biome ;
- `bun:test` ;
- versions directes épinglées dans `package.json` et lockfile versionné ;
- pas de `any` applicatif ;
- pas de `class-validator`/`class-transformer` pour dupliquer les schémas Effect ;
- pas d'ORM ;
- pas de Redis/NATS/PostgreSQL ;
- pas de Docker Compose GPU dans ce lot ;
- pas de reset destructif du dépôt ;
- pas de génération automatique de fichiers non nécessaires.

## 2. Carte de fichiers cible

```text
.
├── .dockerignore
├── .gitignore
├── README.md
├── biome.json
├── bun.lock
├── compose.yaml
├── config/
│   └── platform.example.yaml
├── docker/
│   └── app.Dockerfile
├── package.json
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── domain/
│   │   └── errors.ts
│   ├── http/
│   │   ├── health.controller.ts
│   │   └── http-error.mapper.ts
│   ├── infra/
│   │   ├── config.ts
│   │   ├── db.ts
│   │   └── telemetry.ts
│   └── runtime/
│       ├── app.layer.ts
│       └── managed-runtime.ts
├── test/
│   ├── config.test.ts
│   ├── db.test.ts
│   └── health.test.ts
└── tsconfig.json
```

Ne créer aucun dossier vide en anticipation des lots suivants.

## Task 1 — Initialiser le package Bun unique

### Files

- Create/Update: `package.json`
- Create: `bun.lock`
- Create: `.gitignore`
- Create: `.dockerignore`

- [ ] **Step 1: vérifier que le dépôt n'est pas un workspace**

Contrôler qu'il n'existe pas de configuration `workspaces` active destinée au nouveau projet.

Expected: le projet cible est un package racine unique.

- [ ] **Step 2: créer `package.json` minimal**

Scripts requis :

```json
{
  "scripts": {
    "dev": "bun --watch src/main.ts",
    "start": "bun src/main.ts",
    "build": "bun build src/main.ts --outdir dist --target bun",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "test": "bun test"
  }
}
```

Les noms exacts de dépendances sont : NestJS common/core/platform-fastify, Fastify, Effect, reflect-metadata, TypeScript, types Bun et Biome.

Ne pas ajouter de librairie tant qu'elle n'est pas utilisée dans ce lot.

- [ ] **Step 3: installer et figer**

Run :

```text
bun install
```

Expected: `bun.lock` existe et aucune dépendance workspace n'est créée.

- [ ] **Step 4: vérifier les scripts**

Run :

```text
bun run --silent typecheck
```

À ce stade une erreur liée à l'absence de `tsconfig.json` est acceptable ; une erreur liée à Node/npm n'est pas acceptable.

## Task 2 — Activer TypeScript strict et Biome

### Files

- Create: `tsconfig.json`
- Create: `biome.json`

- [ ] **Step 1: configurer TypeScript**

Le fichier active au minimum :

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "noPropertyAccessFromIndexSignature": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["bun"]
  }
}
```

Adapter uniquement les options nécessaires à la version TypeScript/Bun réellement installée.

- [ ] **Step 2: configurer Biome**

Règles attendues :

- formatter activé ;
- linter activé ;
- imports organisés ;
- `dist`, `data` et artefacts générés ignorés ;
- pas de règle contournée globalement pour faciliter NestJS.

- [ ] **Step 3: ajouter un test garde-fou de type**

Créer un test/fixture qui utilise `@ts-expect-error` pour prouver qu'un mauvais type de config n'est pas assignable.

- [ ] **Step 4: vérifier**

Run :

```text
bun run format:check
bun run lint
bun run typecheck
```

Expected: vert avant de poursuivre.

## Task 3 — Définir les erreurs et la configuration avec Effect Schema

### Files

- Create: `src/domain/errors.ts`
- Create: `src/infra/config.ts`
- Create: `config/platform.example.yaml`
- Create: `test/config.test.ts`

- [ ] **Step 1: définir `ConfigError`**

`ConfigError` est une erreur de domaine discriminée contenant un message public et, pour les logs, la cause décodée sans secret.

Aucune exception brute de parse YAML/JSON ne remonte au bootstrap.

- [ ] **Step 2: définir les schémas**

Le lot 1 ne définit que les champs déjà nécessaires :

```text
server.host
server.port
server.bodyLimitBytes
security.auth
security.apiKeyEnv
queue.maxQueuedJobs
queue.maxRunningJobs
queue.maxAttempts
queue.leaseSeconds
queue.pollIntervalMs
storage.root
engines[]
```

`engines[]` peut être vide dans ce lot.

Chaque champ numérique possède une borne raisonnable.

- [ ] **Step 3: charger la config**

Ordre :

1. chemin depuis `PLATFORM_CONFIG` ou valeur par défaut documentée ;
2. lecture ;
3. parse YAML ;
4. decode `Effect.Schema` ;
5. résolution des secrets depuis l'environnement ;
6. exposition d'un objet immutable typé.

Ne jamais interpoler arbitrairement `${...}` dans le YAML.

- [ ] **Step 4: écrire les tests**

Cas minimum :

- config valide ;
- port hors borne ;
- capacité de queue négative ;
- engine sans URL ;
- backend inconnu ;
- clé de secret absente quand auth active ;
- champ inconnu si le schéma est configuré strict.

- [ ] **Step 5: vérifier**

Run :

```text
bun test test/config.test.ts
bun run typecheck
```

## Task 4 — Ajouter SQLite scoped et migrations minimales

### Files

- Create: `src/infra/db.ts`
- Create: `test/db.test.ts`

- [ ] **Step 1: créer le service Database**

Le Layer :

- crée le dossier parent si nécessaire ;
- ouvre SQLite avec `strict: true` ;
- active `PRAGMA journal_mode = WAL` ;
- active `PRAGMA foreign_keys = ON` ;
- ferme proprement la base à la libération du scope.

- [ ] **Step 2: créer la migration v1**

Créer uniquement la table technique de migration et les tables minimales déjà utiles à la suite :

```sql
CREATE TABLE jobs (...);
CREATE TABLE results (...);
```

Même si l'API jobs arrive au lot 2, la structure doit être compatible avec la spec et testable ici.

Colonnes `status`, `request_json` et timestamps sont obligatoires.

- [ ] **Step 3: rendre la migration idempotente**

Le démarrage deux fois sur la même base ne doit ni échouer ni réinitialiser les données.

- [ ] **Step 4: tests SQLite**

Tester :

- création de fichier ;
- WAL activé ;
- foreign keys ;
- migration fresh ;
- deuxième démarrage ;
- fermeture puis réouverture ;
- aucune donnée effacée.

- [ ] **Step 5: vérifier**

Run :

```text
bun test test/db.test.ts
```

## Task 5 — Construire le runtime Effect unique

### Files

- Create: `src/infra/telemetry.ts`
- Create: `src/runtime/app.layer.ts`
- Create: `src/runtime/managed-runtime.ts`

- [ ] **Step 1: composer les Layers**

`AppLayer` fournit au minimum :

```text
Config
Database
Telemetry
```

Les dépendances sont construites une seule fois.

- [ ] **Step 2: créer le `ManagedRuntime`**

Exporter une unique fabrique de runtime utilisée par NestJS.

Interdit : créer un runtime à chaque requête.

- [ ] **Step 3: prévoir un shutdown propre**

Le shutdown NestJS libère le runtime Effect puis SQLite.

- [ ] **Step 4: test de cycle de vie**

Le test crée le runtime, récupère Config/Database, puis le dispose sans handle restant.

## Task 6 — Brancher NestJS/Fastify sans logique métier

### Files

- Create: `src/app.module.ts`
- Create: `src/main.ts`
- Create: `src/http/health.controller.ts`
- Create: `src/http/http-error.mapper.ts`
- Create: `test/health.test.ts`

- [ ] **Step 1: bootstrap NestJS avec Fastify**

Le bootstrap :

- charge la config via Effect ;
- construit NestJS ;
- applique la limite de body ;
- active les shutdown hooks ;
- écoute sur host/port configurés.

- [ ] **Step 2: exposer `/health/live`**

Réponse 200 si le processus répond.

Exemple :

```json
{ "status": "ok" }
```

- [ ] **Step 3: exposer `/health/ready`**

Vérifier via Effect :

- runtime initialisé ;
- SQLite répond à `SELECT 1` ;
- config valide.

L'absence de moteur est autorisée dans le lot 1.

- [ ] **Step 4: mapper les erreurs**

Créer un mapper exhaustif des erreurs de bootstrap/health vers HTTP sans stack trace publique.

- [ ] **Step 5: tests HTTP**

Tester :

- live 200 ;
- ready 200 avec DB ;
- ready non-200 si DB simulée indisponible ;
- content type JSON ;
- pas de champ interne sensible.

- [ ] **Step 6: vérifier**

Run :

```text
bun test test/health.test.ts
bun run typecheck
```

## Task 7 — Containeriser uniquement l'application

### Files

- Create: `docker/app.Dockerfile`
- Create: `compose.yaml`
- Update: `.dockerignore`

- [ ] **Step 1: construire une image Bun minimale**

Contraintes runtime :

- utilisateur non-root ;
- dépendances installées avec lockfile ;
- code/build copiés explicitement ;
- `/data` comme volume writable ;
- config montée read-only.

- [ ] **Step 2: ajouter le Compose lot 1**

Un seul service :

```text
app
```

Ne pas ajouter de moteur factice, Redis, proxy ou observability stack.

- [ ] **Step 3: hardening Compose**

Ajouter si supporté par le runtime cible :

- `read_only: true` ;
- tmpfs pour `/tmp` ;
- `security_opt: no-new-privileges:true` ;
- `cap_drop: [ALL]` ;
- volume nommé pour `/data` ;
- healthcheck sur `/health/ready`.

- [ ] **Step 4: smoke**

Run conceptuel :

```text
docker compose build app
docker compose up -d app
curl /health/live
curl /health/ready
```

Expected: 200/200 et fichier SQLite présent dans le volume.

## Task 8 — Documenter la boucle développeur

### Files

- Create/Update: `README.md`

- [ ] **Step 1: documenter les prérequis**

- Bun ;
- Docker facultatif pour le lot 1.

- [ ] **Step 2: documenter le local**

```text
bun install
cp config/platform.example.yaml config/platform.yaml
bun run dev
```

Les secrets ne sont pas ajoutés au YAML d'exemple.

- [ ] **Step 3: documenter la qualité**

```text
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

- [ ] **Step 4: documenter Docker**

Décrire uniquement `docker compose up app` pour ce lot. Les profils Stable Diffusion sont documentés dans les lots ultérieurs.

## Task 9 — Audit de fin de lot

- [ ] **Step 1: vérifier l'absence de monorepo**

Expected :

```text
1 package.json racine
0 package.json sous src/
0 workspaces
```

- [ ] **Step 2: vérifier le typage**

Rechercher :

```text
any
@ts-ignore
as unknown as
```

Examiner chaque occurrence ; aucune occurrence applicative non justifiée ne reste.

- [ ] **Step 3: vérifier les dépendances**

Toute dépendance directe est utilisée. Aucun ORM, broker, Redis, OpenAPI generator ou CLI framework inutile n'est présent.

- [ ] **Step 4: exécuter la porte finale**

```text
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
docker compose build app
```

- [ ] **Step 5: smoke Docker final**

Démarrer `app`, vérifier live/ready, redémarrer le conteneur et vérifier que SQLite existe toujours.

## Définition de fin du lot 1

Le lot est terminé uniquement si :

- le dépôt est un package Bun unique ;
- NestJS/Fastify démarre sous Bun ;
- toute la configuration est décodée par Effect Schema ;
- un `ManagedRuntime` unique fournit les dépendances ;
- SQLite WAL est initialisée et survit au restart ;
- live/ready sont testés ;
- le conteneur app est non-root et durci ;
- format, lint, typecheck, tests et build passent ;
- aucun moteur Stable Diffusion, broker ou package additionnel n'a été ajouté prématurément.
