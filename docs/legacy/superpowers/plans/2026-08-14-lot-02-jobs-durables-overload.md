# Lot 2 — Jobs durables et overload Implementation Plan

> **Pour les agents Superpowers :** utiliser un développement task-by-task
> (subagent-driven-development recommandé, sinon executing-plans). Cocher les
> étapes seulement après exécution des vérifications associées. Ne pas créer de
> worktree, monorepo, package interne ou service secondaire.

**Goal:** Créer l'API asynchrone durable `/v1/jobs` (POST/GET/DELETE) avec
admission bornée, transitions d'état exhaustives et overload (429), sans encore
lancer d'inférence réelle.

**Architecture:** NestJS reste un adaptateur HTTP mince. Le domaine (`Job`,
`JobStatus`, `PublicError`), les services (`JobService`, `RateLimiter`) et
l'infrastructure (`JobRepository` SQLite) sont des services Effect exposés par le
`ManagedRuntime` unique du lot 1. La capacité (`maxQueuedJobs`) est vérifiée de
façon atomique à l'insertion (transaction SQLite) ; le claim de job (transaction
atomique, lease, `attempt`) est livré et testé maintenant pour préparer le lot 3.

**Tech Stack:** Bun 1.3.14, TypeScript 5.9.3 strict, NestJS 11.1.29 + Fastify
5.11.0, Effect 3.22.1 (Schema, ManagedRuntime, Ref, Option), `bun:sqlite`,
Biome 2.5.5, `bun:test`.

---

## Contraintes inchangées du programme

- Un seul `package.json`, un seul `src/`, pas de workspace.
- Travailler dans le dépôt principal, sur `master` ; aucun commit sans demande
  séparée.
- Effect porte la logique ; NestJS ne fait que l'adaptation HTTP.
- Toute donnée externe est décodée avec `Effect.Schema` ; aucune exception brute
  ne remonte au HTTP.
- Porte du lot 1 déjà verte : `format:check`, `lint`, `typecheck`, `test`,
  `build`, `docker compose build app`.
- Ne contourner aucune règle Biome de façon globale ; les exceptions ciblées
  (imports `bun:*`) sont documentées dans `biome.json`.

## Périmètre et décisions

- `JobRequest` : modèle, prompt, negativePrompt optionnel, width/height/steps/
  cfgScale/seed/count. Aucun fichier image en lot 2 : « stockage borné des
  inputs » = limite de taille du corps (Fastify `bodyLimit`) + rejet
  `maxInputBytes` avant toute écriture. Le stockage fichier arrive avec
  l'img2img (lot 3).
- `models` devient une map config `{ engineModel, maxWidth, maxHeight }` ;
  l'admission refuse tout modèle non déclaré et borne les dimensions par
  `min(limite globale, limite du modèle)`.
- Config étendue : sections `limits` et `models` (schéma strict, bornes).
- Statuts : `queued -> running -> succeeded`, `queued -> cancelled`,
  `running -> failed|cancelled` ; transitions terminales vides.
- En lot 2 : `DELETE` annule un job `queued` (atomique) ; un job `running`
  répond `409 JOB_NOT_CANCELLABLE` (annulation moteur au lot 3) ; un job
  terminal répond 200 avec son état (idempotent).
- `Retry-After` : en-tête posé par un filtre Nest dédié sur les réponses 429.
- Rate limit : fenêtre fixe en mémoire (par clé, défaut 60 req/min), service
  Effect paramétrable par layer pour les tests.
- Timestamps ISO (`new Date().toISOString()`). L'utilisation de l'horloge
  Effect est reportée à un lot où la déterminisme devient critique.

## Carte des fichiers du lot

```text
Créés :
  src/domain/job.ts
  src/services/job.service.ts
  src/infra/job.repository.ts
  src/infra/rate-limiter.ts
  src/http/jobs.controller.ts
  src/http/public-http.exception.ts
  src/http/http-exception.filter.ts
  test/fixtures/config.ts
  test/domain/job.test.ts
  test/infra/job.repository.test.ts
  test/infra/rate-limiter.test.ts
  test/services/job.service.test.ts
  test/http/jobs.http.test.ts
  test/jobs.integration.test.ts

Modifiés :
  src/domain/errors.ts            (+ 6 erreurs de domaine)
  src/infra/config.ts             (+ limits, models)
  src/http/http-error.mapper.ts   (PublicError + Retry-After + HttpStatus)
  src/runtime/app.layer.ts        (+ JobRepository, JobService, RateLimiter)
  src/app.module.ts               (+ JobsController)
  src/main.ts                     (+ filtre global)
  config/platform.example.yaml    (+ limits, models)
  README.md                       (endpoints /v1/jobs)
  biome.json                      (override bun:sqlite pour job.repository.ts)
  test/config.test.ts             (validYaml + nouveaux cas limits)
  test/db.test.ts                 (fixtures partagés)
  test/health.test.ts             (fixtures partagés + forme PublicError)
  test/runtime.test.ts            (fixtures partagés)
```

---

## Task 1 — Étendre la configuration : `limits` et `models`

### Files

- Modify: `src/infra/config.ts`
- Modify: `config/platform.example.yaml`
- Modify: `test/config.test.ts`
- Modify: `test/db.test.ts`, `test/health.test.ts`, `test/runtime.test.ts` (fixtures `makeConfig` compilent à nouveau)

- [x] **Step 1: ajouter les constantes et schémas `limits`/`models`**

Dans `src/infra/config.ts`, après les constantes existantes, ajouter :

```ts
const MIN_LIMIT = 1;
const MAX_DIMENSION = 8192;
const MAX_STEPS = 10_000;
const MAX_BATCH = 128;
const MAX_PIXELS = 268_435_456;
const MAX_INPUT_BYTES = 1_073_741_824;
const MAX_JOB_COST = 1_000_000_000_000;

const LimitsSchema = Schema.Struct({
  maxBatch: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_BATCH)),
  maxHeight: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_DIMENSION)),
  maxInputBytes: Schema.Int.pipe(Schema.between(1024, MAX_INPUT_BYTES)),
  maxJobCost: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_JOB_COST)),
  maxPixels: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_PIXELS)),
  maxSteps: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_STEPS)),
  maxWidth: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_DIMENSION)),
});

const ModelConfigSchema = Schema.Struct({
  engineModel: NonEmptyString,
  maxHeight: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_DIMENSION)),
  maxWidth: Schema.Int.pipe(Schema.between(MIN_LIMIT, MAX_DIMENSION)),
});

const ModelsSchema = Schema.Record({ key: NonEmptyString, value: ModelConfigSchema });
```

Ajouter `limits: LimitsSchema` et `models: ModelsSchema` dans
`PlatformConfigSchema` (ordre alphabétique des clés : `engines, limits, models,
queue, security, server, storage`).

Ajouter les interfaces exportées (avant les autres exports, tout en fin de
fichier) :

```ts
export interface LimitsConfig {
  readonly maxBatch: number;
  readonly maxHeight: number;
  readonly maxInputBytes: number;
  readonly maxJobCost: number;
  readonly maxPixels: number;
  readonly maxSteps: number;
  readonly maxWidth: number;
}

export interface ModelConfig {
  readonly engineModel: string;
  readonly maxHeight: number;
  readonly maxWidth: number;
}
```

Et dans `PlatformConfig` :

```ts
  readonly limits: LimitsConfig;
  readonly models: Readonly<Record<string, ModelConfig>>;
```

- [x] **Step 2: mettre à jour `config/platform.example.yaml`**

Ajouter après la section `queue` :

```yaml
limits:
  maxBatch: 4
  maxHeight: 2048
  maxInputBytes: 10485760
  maxJobCost: 300000000
  maxPixels: 4194304
  maxSteps: 80
  maxWidth: 2048

models:
  flux-schnell:
    engineModel: flux-schnell
    maxHeight: 1536
    maxWidth: 1536
  sdxl:
    engineModel: sdxl
    maxHeight: 1536
    maxWidth: 1536
```

- [x] **Step 3: mettre à jour le YAML valide de `test/config.test.ts`**

Ajouter les sections `limits` et `models` au `validYaml` (mêmes valeurs que
l'exemple). Ajouter deux tests de rejet dans `describe("config rejection")` :

```ts
test("rejects a negative maxInputBytes", async () => {
  const yaml = validYaml.replace("maxInputBytes: 10485760", "maxInputBytes: -5");
  const path = await writeConfig(yaml);
  await expect(loadFail(path, { [apiKeyEnvVar]: "secret" })).resolves.toBeInstanceOf(ConfigError);
});

test("rejects an unknown key inside limits", async () => {
  const yaml = validYaml.replace("maxBatch: 4", "maxBatch: 4\nunexpectedLimit: 1");
  const path = await writeConfig(yaml);
  await expect(loadFail(path, { [apiKeyEnvVar]: "secret" })).resolves.toBeInstanceOf(ConfigError);
});
```

- [x] **Step 4: corriger les fixtures `makeConfig` des trois tests existants**

Dans `test/db.test.ts`, `test/health.test.ts` et `test/runtime.test.ts`, ajouter
`limits` et `models` aux objets retournés par leur `makeConfig` local :

```ts
  limits: {
    maxBatch: 4,
    maxHeight: 2048,
    maxInputBytes: 10_485_760,
    maxJobCost: 300_000_000,
    maxPixels: 4_194_304,
    maxSteps: 80,
    maxWidth: 2048,
  },
  models: {
    ["flux-schnell"]: { engineModel: "flux-schnell", maxHeight: 1536, maxWidth: 1536 },
    sdxl: { engineModel: "sdxl", maxHeight: 1536, maxWidth: 1536 },
  },
```

Note : `["flux-schnell"]` (clé calculée) évite la règle Biome
`useNamingConvention` sur les clés d'objet non camelCase. Les clés des sections
doivent rester triées (Biome `useSortedKeys`).

- [x] **Step 5: vérifier**

```text
bun test test/config.test.ts
bun run typecheck
./node_modules/.bin/biome check .
```

Expected: tout vert. `config.test.ts` : 12 tests (9 existants + 2 nouveaux +
garde de type).

## Task 2 — Domaine : schémas, transitions, coût, erreurs

### Files

- Create: `src/domain/job.ts`
- Modify: `src/domain/errors.ts`
- Create: `test/domain/job.test.ts`

- [x] **Step 1: écrire le test du domaine**

Créer `test/domain/job.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

import {
  JobRequestSchema,
  canTransition,
  estimateRetryAfter,
  jobCost,
} from "../../src/domain/job.js";
import type { JobRequest, JobStatus } from "../../src/domain/job.js";

const validRequest: JobRequest = {
  cfgScale: 7,
  count: 1,
  height: 1024,
  model: "sdxl",
  prompt: "a lighthouse in a storm",
  steps: 30,
  width: 1024,
};

const decode = (value: unknown) =>
  Schema.decodeUnknownSync(JobRequestSchema, { onExcessProperty: "error" })(value);

describe("JobRequestSchema", () => {
  test("decodes a valid request", () => {
    const request = decode(validRequest);
    expect(request.model).toBe("sdxl");
    expect(request.seed).toBeUndefined();
  });

  test("decodes optional negativePrompt and seed", () => {
    const request = decode({ ...validRequest, negativePrompt: "low quality", seed: 42 });
    expect(request.negativePrompt).toBe("low quality");
    expect(request.seed).toBe(42);
  });

  test("rejects an unknown field", () => {
    expect(() => decode({ ...validRequest, extra: true })).toThrow();
  });

  test("rejects a negative width", () => {
    expect(() => decode({ ...validRequest, width: -1 })).toThrow();
  });
});

describe("job transitions", () => {
  test("allows queued to running and cancelled", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("queued", "cancelled")).toBe(true);
  });

  test("allows running to succeeded, failed and cancelled", () => {
    expect(canTransition("running", "succeeded")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
  });

  test("forbids all transitions from terminal states and backwards jumps", () => {
    expect(canTransition("succeeded", "running")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("queued", "succeeded")).toBe(false);
  });
});

describe("job cost", () => {
  test("cost is width * height * steps * count", () => {
    expect(jobCost({ ...validRequest, width: 512, height: 512, steps: 20, count: 2 })).toBe(10_485_760);
  });
});

describe("retry estimate", () => {
  test("is bounded between 1 and 60 seconds", () => {
    expect(estimateRetryAfter(0, 4)).toBe(1);
    expect(estimateRetryAfter(400, 4)).toBe(60);
    expect(estimateRetryAfter(10, 4)).toBe(3);
  });
});

// Garde de type : un statut invalide est rejeté à la compilation.
export function jobTypeGuard(): void {
  // @ts-expect-error - only the five JobStatus literals are valid
  const status: JobStatus = "inflight";
  if (status === "inflight") {
    throw new Error("unreachable type guard");
  }
}
```

- [x] **Step 2: vérifier que le test échoue (modules manquants)**

Run : `bun test test/domain/job.test.ts`
Expected: échec « cannot find module ../../src/domain/job.js ».

- [x] **Step 3: implémenter `src/domain/job.ts`**

```ts
import { Schema } from "effect";

export const JobStatusSchema = Schema.Literal(
  "cancelled",
  "failed",
  "queued",
  "running",
  "succeeded",
);

export type JobStatus = Schema.Schema.Type<typeof JobStatusSchema>;

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 8192;
const MIN_STEPS = 1;
const MAX_STEPS = 10_000;
const MIN_BATCH = 1;
const MAX_BATCH = 128;
const MAX_CFG_SCALE = 64;
const MIN_RETRY_AFTER = 1;
const MAX_RETRY_AFTER = 600;

export const JobRequestSchema = Schema.Struct({
  cfgScale: Schema.Number.pipe(Schema.between(0, MAX_CFG_SCALE)),
  count: Schema.Int.pipe(Schema.between(MIN_BATCH, MAX_BATCH)),
  height: Schema.Int.pipe(Schema.between(MIN_DIMENSION, MAX_DIMENSION)),
  model: Schema.NonEmptyString,
  negativePrompt: Schema.optional(Schema.String),
  prompt: Schema.NonEmptyString,
  seed: Schema.optional(Schema.NonNegativeInt),
  steps: Schema.Int.pipe(Schema.between(MIN_STEPS, MAX_STEPS)),
  width: Schema.Int.pipe(Schema.between(MIN_DIMENSION, MAX_DIMENSION)),
});

export type JobRequest = Schema.Schema.Type<typeof JobRequestSchema>;

export interface Job {
  readonly attempt: number;
  readonly cost: number;
  readonly createdAt: string;
  readonly engineId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly id: string;
  readonly leaseUntil?: string;
  readonly remoteJobId?: string;
  readonly request: JobRequest;
  readonly status: JobStatus;
  readonly updatedAt: string;
}

export const PublicErrorCodeSchema = Schema.Literal(
  "CONFIG_ERROR",
  "DB_UNAVAILABLE",
  "INVALID_REQUEST",
  "JOB_NOT_CANCELLABLE",
  "JOB_NOT_FOUND",
  "LIMIT_EXCEEDED",
  "QUEUE_FULL",
  "RATE_LIMITED",
  "UNKNOWN",
);

export type PublicErrorCode = Schema.Schema.Type<typeof PublicErrorCodeSchema>;

export const PublicErrorSchema = Schema.Struct({
  code: PublicErrorCodeSchema,
  message: Schema.NonEmptyString,
  retryAfterSeconds: Schema.optional(
    Schema.Int.pipe(Schema.between(MIN_RETRY_AFTER, MAX_RETRY_AFTER)),
  ),
});

export type PublicError = Schema.Schema.Type<typeof PublicErrorSchema>;

export const jobTransitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  cancelled: [],
  failed: [],
  queued: ["cancelled", "running"],
  running: ["cancelled", "failed", "succeeded"],
  succeeded: [],
};

export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  jobTransitions[from].includes(to);

export const jobCost = (request: JobRequest): number =>
  request.count * request.height * request.steps * request.width;

const MIN_ESTIMATE_SECONDS = 1;
const MAX_ESTIMATE_SECONDS = 60;

export const estimateRetryAfter = (active: number, maxRunning: number): number =>
  Math.min(
    MAX_ESTIMATE_SECONDS,
    Math.max(MIN_ESTIMATE_SECONDS, Math.ceil(active / Math.max(MIN_ESTIMATE_SECONDS, maxRunning))),
  );
```

- [x] **Step 4: étendre `src/domain/errors.ts`**

Ajouter (les constantes `Data.TaggedError` restent des valeurs, pas des classes) :

```ts
export const InvalidRequest = Data.TaggedError("InvalidRequest")<{
  readonly message: string;
}>;

export const JobNotCancellable = Data.TaggedError("JobNotCancellable")<{
  readonly message: string;
}>;

export const JobNotFound = Data.TaggedError("JobNotFound")<{
  readonly id: string;
}>;

export const LimitExceeded = Data.TaggedError("LimitExceeded")<{
  readonly message: string;
}>;

export const QueueFull = Data.TaggedError("QueueFull")<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}>;

export const RateLimited = Data.TaggedError("RateLimited")<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}>;
```

Mettre à jour l'union (avec les alias de types d'instance comme pour
`ConfigError`) :

```ts
export type InvalidRequest = InstanceType<typeof InvalidRequest>;
export type JobNotCancellable = InstanceType<typeof JobNotCancellable>;
export type JobNotFound = InstanceType<typeof JobNotFound>;
export type LimitExceeded = InstanceType<typeof LimitExceeded>;
export type QueueFull = InstanceType<typeof QueueFull>;
export type RateLimited = InstanceType<typeof RateLimited>;

export type DomainError =
  | ConfigError
  | DatabaseError
  | InvalidRequest
  | JobNotCancellable
  | JobNotFound
  | LimitExceeded
  | QueueFull
  | RateLimited;
```

- [x] **Step 5: vérifier**

Run :
```text
bun test test/domain/job.test.ts
bun run typecheck
./node_modules/.bin/biome check --write .
```

Expected: 9 tests verts, typecheck vert, Biome vert.

## Task 3 — `JobRepository` : insertions atomiques, transitions, claim

### Files

- Create: `src/infra/job.repository.ts`
- Modify: `biome.json` (override `noUnresolvedImports` pour `src/infra/job.repository.ts`, import `bun:sqlite`)
- Create: `test/infra/job.repository.test.ts`

- [x] **Step 1: étendre l'override Biome pour `bun:sqlite`**

Dans `biome.json`, remplacer l'override ciblé existant :

```json
    {
      "includes": ["src/infra/db.ts"],
      "linter": {
        "rules": {
          "correctness": {
            "noUnresolvedImports": "off"
          }
        }
      }
    }
```

par le même bloc avec `"includes": ["src/infra/db.ts", "src/infra/job.repository.ts"]`.

- [x] **Step 2: écrire les tests du repository**

Créer `test/infra/job.repository.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";

import { JobRepository } from "../../src/infra/job.repository.js";
import type { Job } from "../../src/domain/job.js";
import { tmpRoot, testLayer } from "../fixtures/config.js";

const run = <A, E>(root: string, effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.provide(effect, testLayer(root)));

const queuedJob = (id: string, createdAt: string): Job => ({
  attempt: 0,
  cost: 1,
  createdAt,
  id,
  request: {
    cfgScale: 7,
    count: 1,
    height: 512,
    model: "sdxl",
    prompt: "a lighthouse in a storm",
    steps: 20,
    width: 512,
  },
  status: "queued",
  updatedAt: createdAt,
});

describe("JobRepository", () => {
  test("creates a job respecting the queued capacity", async () => {
    const root = tmpRoot("job-repo");
    const inserted = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        const first = yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 1);
        const second = yield* repo.createIfCapacity(queuedJob("job_2", "2026-01-01T00:00:01.000Z"), 1);
        const active = yield* repo.countActive();
        return { first, second, active };
      }),
    );
    expect(inserted.first).toBe(true);
    expect(inserted.second).toBe(false);
    expect(inserted.active).toBe(1);
  });

  test("reads back a job with its decoded request", async () => {
    const root = tmpRoot("job-repo");
    const job = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 10);
        return yield* repo.getById("job_1");
      }),
    );
    expect(Option.isSome(job)).toBe(true);
    if (Option.isSome(job)) {
      expect(job.value.status).toBe("queued");
      expect(job.value.request.prompt).toBe("a lighthouse in a storm");
    }
  });

  test("returns None for an unknown id", async () => {
    const root = tmpRoot("job-repo");
    const job = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        return yield* repo.getById("job_missing");
      }),
    );
    expect(Option.isNone(job)).toBe(true);
  });

  test("transitions a queued job to cancelled atomically", async () => {
    const root = tmpRoot("job-repo");
    const state = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 10);
        const updated = yield* repo.transition("job_1", "queued", "cancelled", {});
        const conflict = yield* repo.transition("job_1", "queued", "cancelled", {});
        return { updated, conflict };
      }),
    );
    expect(Option.isSome(state.updated)).toBe(true);
    if (Option.isSome(state.updated)) {
      expect(state.updated.value.status).toBe("cancelled");
    }
    expect(Option.isNone(state.conflict)).toBe(true);
  });

  test("claims the oldest queued job respecting the running cap, without double claims", async () => {
    const root = tmpRoot("job-repo");
    const state = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 10);
        yield* repo.createIfCapacity(queuedJob("job_2", "2026-01-01T00:00:01.000Z"), 10);
        yield* repo.createIfCapacity(queuedJob("job_3", "2026-01-01T00:00:02.000Z"), 10);
        const claims = [];
        for (const lease of ["2026-01-02T00:00:00.000Z", "2026-01-02T00:00:01.000Z", "2026-01-02T00:00:02.000Z"]) {
          claims.push(yield* repo.claimNext(lease, 2));
        }
        return claims;
      }),
    );
    const claimed = state.filter(Option.isSome);
    expect(claimed.length).toBe(2);
    const ids = claimed.map((entry) => entry.value.id).sort();
    expect(ids).toEqual(["job_1", "job_2"]);
  });

  test("concurrent claims never exceed the running cap and claim each job once", async () => {
    const root = tmpRoot("job-repo");
    await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 10);
        yield* repo.createIfCapacity(queuedJob("job_2", "2026-01-01T00:00:01.000Z"), 10);
        yield* repo.createIfCapacity(queuedJob("job_3", "2026-01-01T00:00:02.000Z"), 10);
        yield* repo.createIfCapacity(queuedJob("job_4", "2026-01-01T00:00:03.000Z"), 10);
      }),
    );
    const claims = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        run(
          root,
          Effect.gen(function* () {
            const repo = yield* JobRepository;
            return yield* repo.claimNext(`2026-01-02T00:00:0${index % 10}.000Z`, 2);
          }),
        ),
      ),
    );
    const claimed = claims.filter(Option.isSome);
    expect(claimed.length).toBe(2);
    expect(new Set(claimed.map((entry) => entry.value.id)).size).toBe(2);
  });

  test("a queued job survives a repository restart", async () => {
    const root = tmpRoot("job-repo");
    await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        yield* repo.createIfCapacity(queuedJob("job_1", "2026-01-01T00:00:00.000Z"), 10);
      }),
    );
    const job = await run(
      root,
      Effect.gen(function* () {
        const repo = yield* JobRepository;
        return yield* repo.getById("job_1");
      }),
    );
    expect(Option.isSome(job)).toBe(true);
    if (Option.isSome(job)) {
      expect(job.value.status).toBe("queued");
    }
  });
});
```

- [x] **Step 3: vérifier que les tests échouent (module manquant)**

Run : `bun test test/infra/job.repository.test.ts`
Expected: échec « cannot find module ../../src/infra/job.repository.js ».

- [x] **Step 4: implémenter `src/infra/job.repository.ts`**

```ts
import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { DatabaseError } from "../domain/errors.js";
import { JobRequestSchema } from "../domain/job.js";
import type { Job, JobRequest, JobStatus } from "../domain/job.js";
import type { DatabaseService } from "./db.js";

const selectJobColumns = `
  id,
  status,
  request_json AS "requestJson",
  cost,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  attempt,
  engine_id AS "engineId",
  remote_job_id AS "remoteJobId",
  lease_until AS "leaseUntil",
  error_code AS "errorCode",
  error_message AS "errorMessage"
`;

interface JobRow {
  attempt: number;
  cost: number;
  createdAt: string;
  engineId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  leaseUntil: string | null;
  remoteJobId: string | null;
  requestJson: string;
  status: string;
  updatedAt: string;
}

const toJob = (row: JobRow, request: JobRequest): Job => {
  const job: Job = {
    attempt: row.attempt,
    cost: row.cost,
    createdAt: row.createdAt,
    id: row.id,
    request,
    // status is written by this application with valid literals only
    status: row.status as JobStatus,
    updatedAt: row.updatedAt,
  };
  if (row.engineId !== null) job.engineId = row.engineId;
  if (row.remoteJobId !== null) job.remoteJobId = row.remoteJobId;
  if (row.leaseUntil !== null) job.leaseUntil = row.leaseUntil;
  if (row.errorCode !== null) job.errorCode = row.errorCode;
  if (row.errorMessage !== null) job.errorMessage = row.errorMessage;
  return job;
};

const decodeRequest = (json: string): Effect.Effect<JobRequest, DatabaseError, never> =>
  Effect.try({
    catch: (cause) =>
      new DatabaseError({ cause, message: "stored request_json is not valid JSON" }),
    try: () => JSON.parse(json),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknown(JobRequestSchema)(value).pipe(
        Effect.mapError(
          (cause) =>
            new DatabaseError({ cause, message: "stored request does not match the schema" }),
        ),
      ),
    ),
  );

const rowToJob = (row: JobRow): Effect.Effect<Option.Option<Job>, DatabaseError, never> =>
  Effect.map(decodeRequest(row.requestJson), (request) => Option.some(toJob(row, request)));

const ACTIVE_STATUSES = "('queued', 'running')";

export interface JobRepository {
  readonly claimNext: (
    leaseUntil: string,
    maxRunningJobs: number,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError, never>;
  readonly countActive: () => Effect.Effect<number, DatabaseError, never>;
  readonly createIfCapacity: (
    job: Job,
    maxQueuedJobs: number,
  ) => Effect.Effect<boolean, DatabaseError, never>;
  readonly getById: (id: string) => Effect.Effect<Option.Option<Job>, DatabaseError, never>;
  readonly transition: (
    id: string,
    from: JobStatus,
    to: JobStatus,
    changes: Readonly<{
      errorCode?: string;
      errorMessage?: string;
      leaseUntil?: string;
    }>,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError, never>;
}

export const JobRepository = Context.Tag("app/JobRepository")<
  JobRepository,
  JobRepository
>();

const createJobRepository = (db: Database): JobRepository => {
  const insertIfCapacity = db.transaction((job: Job, maxQueuedJobs: number): boolean => {
    const active = db
      .query<{ c: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS c FROM jobs WHERE status IN ${ACTIVE_STATUSES}`,
      )
      .get();
    const activeCount = active?.c ?? 0;
    if (activeCount >= maxQueuedJobs) return false;
    db.run(
      `INSERT INTO jobs (id, status, request_json, cost, created_at, updated_at, attempt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [job.id, job.status, JSON.stringify(job.request), job.cost, job.createdAt, job.updatedAt, job.attempt],
    );
    return true;
  });

  const claimNextTx = db.transaction(
    (leaseUntil: string, maxRunningJobs: number): JobRow | null => {
      const running = db
        .query<{ c: number }, SQLQueryBindings[]>(
          "SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'",
        )
        .get();
      if ((running?.c ?? 0) >= maxRunningJobs) return null;
      const candidate = db
        .query<{ id: string }, SQLQueryBindings[]>(
          "SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1",
        )
        .get();
      if (candidate === null || candidate === undefined) return null;
      db.run(
        `UPDATE jobs SET status = 'running', lease_until = ?, attempt = attempt + 1, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
        [leaseUntil, new Date().toISOString(), candidate.id],
      );
      return (
        db
          .query<JobRow, SQLQueryBindings[]>(
            `SELECT ${selectJobColumns} FROM jobs WHERE id = ?`,
          )
          .get(candidate.id) ?? null
      );
    },
  );

  const runTx = <A>(message: string, run: () => A): Effect.Effect<A, DatabaseError, never> =>
    Effect.try({
      catch: (cause) => new DatabaseError({ cause, message }),
      try: run,
    });

  return {
    claimNext: (leaseUntil, maxRunningJobs) =>
      runTx("claim next job failed", () => claimNextTx(leaseUntil, maxRunningJobs)).pipe(
        Effect.flatMap((row) => (row === null ? Effect.succeed(Option.none()) : rowToJob(row))),
      ),
    countActive: () =>
      runTx("count active jobs failed", () =>
        db
          .query<{ c: number }, SQLQueryBindings[]>(
            `SELECT COUNT(*) AS c FROM jobs WHERE status IN ${ACTIVE_STATUSES}`,
          )
          .get()?.c ?? 0,
      ),
    createIfCapacity: (job, maxQueuedJobs) =>
      runTx("insert job failed", () => insertIfCapacity(job, maxQueuedJobs)),
    getById: (id) =>
      runTx("read job failed", () =>
        db
          .query<JobRow, SQLQueryBindings[]>(`SELECT ${selectJobColumns} FROM jobs WHERE id = ?`)
          .get(id) ?? null,
      ).pipe(
        Effect.flatMap((row) => (row === null ? Effect.succeed(Option.none()) : rowToJob(row))),
      ),
    transition: (id, from, to, changes) =>
      runTx("transition job failed", () => {
        const result = db.run(
          `UPDATE jobs
           SET status = ?, updated_at = ?,
               lease_until = COALESCE(?, lease_until),
               error_code = COALESCE(?, error_code),
               error_message = COALESCE(?, error_message)
           WHERE id = ? AND status = ?`,
          [to, new Date().toISOString(), changes.leaseUntil ?? null, changes.errorCode ?? null, changes.errorMessage ?? null, id, from],
        );
        if (result.changes === 0) return null;
        return (
          db
            .query<JobRow, SQLQueryBindings[]>(`SELECT ${selectJobColumns} FROM jobs WHERE id = ?`)
            .get(id) ?? null
        );
      }).pipe(
        Effect.flatMap((row) => (row === null ? Effect.succeed(Option.none()) : rowToJob(row))),
      ),
  };
};

export const JobRepositoryLayer: Layer.Layer<
  JobRepository,
  never,
  DatabaseService
> = Layer.effect(
  JobRepository,
  Effect.gen(function* () {
    const database = yield* DatabaseService;
    return createJobRepository(database.sqlite);
  }),
);
```

Note : les alias SQL `AS "requestJson"` etc. évitent les clés snake_case dans les
types TS (règle Biome `useNamingConvention`).

- [x] **Step 5: vérifier**

```text
bun test test/infra/job.repository.test.ts
bun run typecheck
./node_modules/.bin/biome check .
```

Expected: 7 tests verts, typecheck et Biome verts. Le fichier de tests importe
`../fixtures/config.js` — créer au Task 6 si absent ; en attendant, ajouter le
garde minimal suivant dans `test/fixtures/config.ts` (créer le fichier) :

```ts
import { Layer } from "effect";

export const tmpRoot = (name: string): string =>
  `${Bun.env["TMPDIR"] ?? "/tmp"}/sd-${name}-${crypto.randomUUID()}`;

export const testLayer = <R>(_root: string): Layer.Layer<R, never, never> =>
  Layer.empty;
```

Ce stub sera remplacé par la vraie couche au Task 6.

## Task 4 — Rate limiter local (fenêtre fixe en mémoire)

### Files

- Create: `src/infra/rate-limiter.ts`
- Create: `test/infra/rate-limiter.test.ts`

- [x] **Step 1: écrire les tests**

Créer `test/infra/rate-limiter.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { RateLimiter, makeRateLimiterLayer } from "../../src/infra/rate-limiter.js";

const run = (effect: Effect.Effect<boolean, never, never>) =>
  Effect.runPromise(Effect.provide(effect, makeRateLimiterLayer(3, 60_000)));

describe("RateLimiter", () => {
  test("allows requests within the window and rejects beyond the cap", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run(RateLimiter.check("ip-1"))),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  test("keys are isolated", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        Effect.runPromise(
          Effect.provide(
            RateLimiter.check(`ip-${index % 2}`),
            makeRateLimiterLayer(2, 60_000),
          ),
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(4);
  });

  test("the window resets after windowMs", async () => {
    const layer = makeRateLimiterLayer(1, 50);
    const check = () =>
      Effect.runPromise(Effect.provide(RateLimiter.check("ip-1"), layer));
    expect(await check()).toBe(true);
    expect(await check()).toBe(false);
    await Bun.sleep(80);
    expect(await check()).toBe(true);
  });
});
```

- [x] **Step 2: vérifier que les tests échouent (module manquant)**

Run : `bun test test/infra/rate-limiter.test.ts`
Expected: échec « cannot find module ».

- [x] **Step 3: implémenter `src/infra/rate-limiter.ts`**

```ts
import { Context, Effect, Layer, Ref } from "effect";

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_STALE_KEYS = 1_000;

export interface RateLimiter {
  readonly check: (key: string) => Effect.Effect<boolean, never, never>;
}

export const RateLimiter = Context.Tag("app/RateLimiter")<RateLimiter, RateLimiter>();

export const makeRateLimiterLayer = (
  maxRequests: number,
  windowMs: number,
): Layer.Layer<RateLimiter, never, never> =>
  Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const state = yield* Ref.make(
        new Map<string, { count: number; windowStart: number }>(),
      );
      const check = (key: string): Effect.Effect<boolean, never, never> =>
        Ref.modify(state, (map) => {
          const now = Date.now();
          const windowStart = Math.floor(now / windowMs) * windowMs;
          const current = map.get(key);
          if (current === undefined || current.windowStart !== windowStart) {
            if (map.size >= MAX_STALE_KEYS) {
              for (const [staleKey, entry] of map) {
                if (entry.windowStart !== windowStart) map.delete(staleKey);
              }
            }
            map.set(key, { count: 1, windowStart });
            return [true, map] as const;
          }
          if (current.count >= maxRequests) {
            return [false, map] as const;
          }
          map.set(key, { count: current.count + 1, windowStart });
          return [true, map] as const;
        });
      return { check };
    }),
  );

export const RateLimiterLive = makeRateLimiterLayer(
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
);
```

- [x] **Step 4: vérifier**

```text
bun test test/infra/rate-limiter.test.ts
bun run typecheck
./node_modules/.bin/biome check .
```

Expected: 3 tests verts, typecheck et Biome verts.

## Task 5 — `JobService` : admission et orchestration

### Files

- Create: `src/services/job.service.ts`
- Create: `test/services/job.service.test.ts`

- [x] **Step 1: écrire les tests du service**

Créer `test/services/job.service.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { JobService } from "../../src/services/job.service.js";
import { tmpRoot, testLayer, makeTestConfig } from "../fixtures/config.js";

const validRequest = {
  cfgScale: 7,
  count: 1,
  height: 1024,
  model: "sdxl",
  prompt: "a lighthouse in a storm",
  steps: 30,
  width: 1024,
};

const run = <A, E>(
  effect: Effect.Effect<A, E, never>,
  root = tmpRoot("job-service"),
  options: { config?: ReturnType<typeof makeTestConfig>; rateLimitMaxRequests?: number } = {},
) =>
  Effect.runPromise(
    Effect.provide(effect, testLayer(root, options)),
  );

describe("JobService.submit", () => {
  test("accepts a valid request and returns a queued job", async () => {
    const result = await run(
      Effect.either(JobService.submit(validRequest, "client-1")),
    );
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.status).toBe("queued");
      expect(result.right.attempt).toBe(0);
      expect(result.right.cost).toBe(1024 * 1024 * 30 * 1);
      expect(result.right.id.startsWith("job_")).toBe(true);
    }
  });

  test("rejects an unknown model", async () => {
    const result = await run(
      Effect.either(JobService.submit({ ...validRequest, model: "unknown-model" }, "client-1")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("InvalidRequest");
    }
  });

  test("rejects dimensions beyond the configured limits", async () => {
    const result = await run(
      Effect.either(JobService.submit({ ...validRequest, width: 3000 }, "client-1")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("LimitExceeded");
    }
  });

  test("rejects a job cost above the maximum", async () => {
    const result = await run(
      Effect.either(
        JobService.submit(
          { ...validRequest, width: 2048, height: 2048, steps: 80, count: 4 },
          "client-1",
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("LimitExceeded");
    }
  });

  test("rejects a request larger than maxInputBytes", async () => {
    const config = makeTestConfig(tmpRoot("job-service"));
    const smallInputConfig = {
      ...config,
      limits: { ...config.limits, maxInputBytes: 256 },
    };
    const result = await run(
      Effect.either(
        JobService.submit(
          { ...validRequest, prompt: "x".repeat(10_000) },
          "client-1",
        ),
      ),
      config.storage.root,
      { config: smallInputConfig },
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("LimitExceeded");
    }
  });

  test("rejects with QUEUE_FULL when the queue capacity is reached", async () => {
    const config = makeTestConfig(tmpRoot("job-service"));
    const smallQueueConfig = {
      ...config,
      queue: { ...config.queue, maxQueuedJobs: 2 },
    };
    const root = config.storage.root;
    await run(Effect.either(JobService.submit(validRequest, "client-1")), root, {
      config: smallQueueConfig,
    });
    await run(Effect.either(JobService.submit(validRequest, "client-1")), root, {
      config: smallQueueConfig,
    });
    const result = await run(Effect.either(JobService.submit(validRequest, "client-1")), root, {
      config: smallQueueConfig,
    });
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("QueueFull");
      expect(result.left.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  test("rejects with RATE_LIMITED after the local limit", async () => {
    const results = [];
    for (let index = 0; index < 3; index += 1) {
      results.push(
        await run(Effect.either(JobService.submit(validRequest, "client-1")), tmpRoot("job-service"), {
          rateLimitMaxRequests: 2,
        }),
      );
    }
    expect(results[0]?._tag).toBe("Right");
    expect(results[1]?._tag).toBe("Right");
    expect(results[2]?._tag).toBe("Left");
    if (results[2]?._tag === "Left") {
      expect(results[2].left._tag).toBe("RateLimited");
    }
  });
});

describe("JobService.get and cancel", () => {
  test("returns the job for an existing id", async () => {
    const root = tmpRoot("job-service");
    const created = await run(Effect.either(JobService.submit(validRequest, "client-1")), root);
    if (created._tag !== "Right") throw new Error("expected submit to succeed");
    const fetched = await run(Effect.either(JobService.get(created.right.id)), root);
    expect(fetched._tag).toBe("Right");
    if (fetched._tag === "Right") {
      expect(fetched.right.id).toBe(created.right.id);
      expect(fetched.right.status).toBe("queued");
    }
  });

  test("returns JOB_NOT_FOUND for an unknown id", async () => {
    const result = await run(Effect.either(JobService.get("job_missing")));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("JobNotFound");
    }
  });

  test("cancels a queued job and is idempotent on terminal jobs", async () => {
    const root = tmpRoot("job-service");
    const created = await run(Effect.either(JobService.submit(validRequest, "client-1")), root);
    if (created._tag !== "Right") throw new Error("expected submit to succeed");
    const cancelled = await run(Effect.either(JobService.cancel(created.right.id)), root);
    expect(cancelled._tag).toBe("Right");
    if (cancelled._tag === "Right") {
      expect(cancelled.right.status).toBe("cancelled");
    }
    const again = await run(Effect.either(JobService.cancel(created.right.id)), root);
    expect(again._tag).toBe("Right");
    if (again._tag === "Right") {
      expect(again.right.status).toBe("cancelled");
    }
  });

  test("rejects cancelling an unknown job", async () => {
    const result = await run(Effect.either(JobService.cancel("job_missing")));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("JobNotFound");
    }
  });
});
```

- [x] **Step 2: vérifier que les tests échouent (module manquant)**

Run : `bun test test/services/job.service.test.ts`
Expected: échec « cannot find module ».

- [x] **Step 3: implémenter `src/services/job.service.ts`**

```ts
import { Context, Effect, Option, Schema } from "effect";

import {
  InvalidRequest,
  JobNotCancellable,
  JobNotFound,
  LimitExceeded,
  QueueFull,
  RateLimited,
} from "../domain/errors.js";
import type { DomainError } from "../domain/errors.js";
import {
  JobRequestSchema,
  canTransition,
  estimateRetryAfter,
  jobCost,
} from "../domain/job.js";
import type { Job } from "../domain/job.js";
import { Config } from "../infra/config.js";
import { JobRepository } from "../infra/job.repository.js";
import { RateLimiter } from "../infra/rate-limiter.js";

const RATE_LIMIT_WINDOW_SECONDS = 60;

export interface JobService {
  readonly cancel: (id: string) => Effect.Effect<Job, DomainError, JobRepository>;
  readonly get: (id: string) => Effect.Effect<Job, DomainError, JobRepository>;
  readonly submit: (
    input: unknown,
    clientKey: string,
  ) => Effect.Effect<Job, DomainError, Config | JobRepository | RateLimiter>;
}

export const JobService = Context.Tag("app/JobService")<JobService, JobService>();

const submit = (input: unknown, clientKey: string) =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(JobRequestSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => new InvalidRequest({ message: "invalid job request" })),
    );
    const rateLimiter = yield* RateLimiter;
    const allowed = yield* rateLimiter.check(clientKey);
    if (!allowed) {
      return yield* Effect.fail(
        new RateLimited({
          message: "too many requests",
          retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
        }),
      );
    }
    const config = yield* Config;
    const model = config.models[request.model];
    if (model === undefined) {
      return yield* Effect.fail(
        new InvalidRequest({ message: `unknown model: ${request.model}` }),
      );
    }
    const maxWidth = Math.min(config.limits.maxWidth, model.maxWidth);
    const maxHeight = Math.min(config.limits.maxHeight, model.maxHeight);
    if (request.width > maxWidth || request.height > maxHeight) {
      return yield* Effect.fail(
        new LimitExceeded({
          message: `dimensions exceed the maximum ${maxWidth}x${maxHeight}`,
        }),
      );
    }
    if (request.width * request.height > config.limits.maxPixels) {
      return yield* Effect.fail(
        new LimitExceeded({ message: "image exceeds the maximum pixel count" }),
      );
    }
    if (request.steps > config.limits.maxSteps) {
      return yield* Effect.fail(
        new LimitExceeded({ message: "steps exceed the configured maximum" }),
      );
    }
    if (request.count > config.limits.maxBatch) {
      return yield* Effect.fail(
        new LimitExceeded({ message: "batch count exceeds the configured maximum" }),
      );
    }
    const cost = jobCost(request);
    if (cost > config.limits.maxJobCost) {
      return yield* Effect.fail(
        new LimitExceeded({ message: "job cost exceeds the configured maximum" }),
      );
    }
    const serializedSize = new TextEncoder().encode(JSON.stringify(request)).byteLength;
    if (serializedSize > config.limits.maxInputBytes) {
      return yield* Effect.fail(
        new LimitExceeded({ message: "request exceeds the maximum input size" }),
      );
    }
    const repository = yield* JobRepository;
    const active = yield* repository.countActive();
    if (active >= config.queue.maxQueuedJobs) {
      return yield* Effect.fail(
        new QueueFull({
          message: "the job queue is full",
          retryAfterSeconds: estimateRetryAfter(active, config.queue.maxRunningJobs),
        }),
      );
    }
    const now = new Date().toISOString();
    const job: Job = {
      attempt: 0,
      cost,
      createdAt: now,
      id: `job_${crypto.randomUUID()}`,
      request,
      status: "queued",
      updatedAt: now,
    };
    const inserted = yield* repository.createIfCapacity(job, config.queue.maxQueuedJobs);
    if (!inserted) {
      return yield* Effect.fail(
        new QueueFull({
          message: "the job queue is full",
          retryAfterSeconds: estimateRetryAfter(active + 1, config.queue.maxRunningJobs),
        }),
      );
    }
    return job;
  });

const get = (id: string) =>
  Effect.gen(function* () {
    const repository = yield* JobRepository;
    const job = yield* repository.getById(id);
    if (Option.isNone(job)) {
      return yield* Effect.fail(new JobNotFound({ id }));
    }
    return job.value;
  });

const cancel = (id: string) =>
  Effect.gen(function* () {
    const repository = yield* JobRepository;
    const current = yield* repository.getById(id);
    if (Option.isNone(current)) {
      return yield* Effect.fail(new JobNotFound({ id }));
    }
    const job = current.value;
    if (job.status === "queued") {
      const updated = yield* repository.transition(id, "queued", "cancelled", {});
      if (Option.isNone(updated)) {
        return yield* Effect.fail(
          new JobNotCancellable({ message: "job is no longer queued" }),
        );
      }
      return updated.value;
    }
    if (job.status === "running") {
      return yield* Effect.fail(
        new JobNotCancellable({ message: "running jobs cannot be cancelled yet" }),
      );
    }
    return job;
  });

export const JobServiceLayer: Layer.Layer<JobService, never, never> = Layer.succeed(
  JobService,
  { cancel, get, submit },
);
```

Note : `canTransition` est importé pour l'exhaustivité ; la transition
`queued -> cancelled` est appliquée de façon atomique par le repository (garde
`WHERE status = ?`). Le contrôle d'exhaustivité des transitions est couvert par
les tests du domaine (Task 2).

- [x] **Step 4: ajouter l'import manquant et vérifier**

Ajouter `import { Layer } from "effect";` en tête de `job.service.ts` (l'extrait
ci-dessus l'utilise). Run :

```text
bun test test/services/job.service.test.ts
bun run typecheck
./node_modules/.bin/biome check --write .
```

Expected: 10 tests verts, typecheck et Biome verts.

## Task 6 — Fixtures partagés et intégration du runtime

### Files

- Create: `test/fixtures/config.ts` (vraie couche de test)
- Modify: `src/runtime/app.layer.ts` (+ `JobRepository`, `JobService`, `RateLimiter`)
- Modify: `test/db.test.ts`, `test/health.test.ts`, `test/runtime.test.ts` (utiliser les fixtures)

- [x] **Step 1: écrire la vraie couche de test partagée**

Remplacer le stub de `test/fixtures/config.ts` par :

```ts
import { BunFileSystem } from "@effect/platform-bun";
import { Layer } from "effect";

import { Config } from "../../src/infra/config.js";
import type { PlatformConfig } from "../../src/infra/config.js";
import { DatabaseLayer, DatabaseService } from "../../src/infra/db.js";
import { JobRepositoryLayer } from "../../src/infra/job.repository.js";
import { RateLimiter, makeRateLimiterLayer } from "../../src/infra/rate-limiter.js";
import { JobServiceLayer } from "../../src/services/job.service.js";
import { TelemetryLayer } from "../../src/infra/telemetry.js";
import type { AppContext } from "../../src/runtime/app.layer.js";

const tmpDirEnvVar = "TMPDIR";
const WINDOW_MS = 60_000;

export const tmpRoot = (name: string): string =>
  `${Bun.env[tmpDirEnvVar] ?? "/tmp"}/sd-${name}-${crypto.randomUUID()}`;

export const makeTestConfig = (root: string): PlatformConfig => ({
  engines: [],
  limits: {
    maxBatch: 4,
    maxHeight: 2048,
    maxInputBytes: 10_485_760,
    maxJobCost: 300_000_000,
    maxPixels: 4_194_304,
    maxSteps: 80,
    maxWidth: 2048,
  },
  models: {
    ["flux-schnell"]: { engineModel: "flux-schnell", maxHeight: 1536, maxWidth: 1536 },
    sdxl: { engineModel: "sdxl", maxHeight: 1536, maxWidth: 1536 },
  },
  queue: {
    leaseSeconds: 120,
    maxAttempts: 2,
    maxQueuedJobs: 100,
    maxRunningJobs: 4,
    pollIntervalMs: 250,
  },
  security: { apiKey: "", auth: "none" },
  server: {
    bodyLimitBytes: 12_582_912,
    host: "0.0.0.0",
    port: 3000,
  },
  storage: { root },
});

export interface TestLayerOptions {
  readonly config?: PlatformConfig;
  readonly databaseService?: DatabaseService;
  readonly rateLimitMaxRequests?: number;
}

export const testLayer = (
  root: string,
  options: TestLayerOptions = {},
): Layer.Layer<AppContext, never, never> => {
  const configLayer = Layer.succeed(Config, options.config ?? makeTestConfig(root));
  const databaseLayer = options.databaseService
    ? Layer.succeed(DatabaseService, options.databaseService)
    : DatabaseLayer;
  const rateLimiterLayer = makeRateLimiterLayer(options.rateLimitMaxRequests ?? 60, WINDOW_MS);
  const databaseProvided = Layer.provide(databaseLayer, configLayer);
  const jobRepositoryProvided = Layer.provide(JobRepositoryLayer, databaseProvided);
  return Layer.orDie(
    Layer.provide(
      Layer.mergeAll(
        databaseProvided,
        jobRepositoryProvided,
        JobServiceLayer,
        rateLimiterLayer,
        configLayer,
        TelemetryLayer,
      ),
      BunFileSystem.layer,
    ),
  );
};
```

- [x] **Step 2: étendre `src/runtime/app.layer.ts`**

Remplacer le contenu par :

```ts
import { BunFileSystem } from "@effect/platform-bun";
import { Layer } from "effect";

import { Config, ConfigLayer } from "../infra/config.js";
import { DatabaseLayer, DatabaseService } from "../infra/db.js";
import { JobRepository, JobRepositoryLayer } from "../infra/job.repository.js";
import { RateLimiter, RateLimiterLive } from "../infra/rate-limiter.js";
import { JobService, JobServiceLayer } from "../services/job.service.js";
import { Telemetry, TelemetryLayer } from "../infra/telemetry.js";

/** Services provided by the application layer. */
export type AppContext =
  | Config
  | DatabaseService
  | JobRepository
  | JobService
  | RateLimiter
  | Telemetry;

const databaseProvided = Layer.provide(DatabaseLayer, ConfigLayer);
const jobRepositoryProvided = Layer.provide(JobRepositoryLayer, databaseProvided);

/**
 * Single application layer: Config, Database, JobRepository, JobService,
 * RateLimiter and Telemetry, with all filesystem dependencies satisfied by
 * the Bun adapter. Built once by `makeRuntime`, never per request.
 */
export const AppLayer = Layer.provide(
  Layer.mergeAll(
    databaseProvided,
    jobRepositoryProvided,
    JobServiceLayer,
    RateLimiterLive,
    ConfigLayer,
    TelemetryLayer,
  ),
  BunFileSystem.layer,
);
```

Note : `JobServiceLayer` n'a pas de dépendance (les méthodes portent leurs
besoins dans leur contexte Effect) ; `jobRepositoryProvided` injecte
`DatabaseService` dans `JobRepositoryLayer`.

- [x] **Step 3: refactorer `test/db.test.ts` sur les fixtures**

Supprimer les helpers locaux (`tmpRoot`, `makeConfig`, `testLayer`, `withDb`)
et les imports devenus inutiles, puis utiliser :

```ts
import { tmpRoot, testLayer } from "./fixtures/config.js";

const withDb = <A, E>(
  root: string,
  effect: Effect.Effect<A, E, AppContext>,
): Promise<A> => Effect.runPromise(Effect.provide(effect, testLayer(root)));
```

Ajuster les types (`Effect.Effect<A, E, AppContext>` au lieu de
`Effect.Effect<A, E, DatabaseService>`). Les assertions restent identiques.
Supprimer l'import de `PlatformConfig`/`Config` si plus utilisé.

- [x] **Step 4: refactorer `test/health.test.ts` sur les fixtures**

Remplacer `makeConfig`, `healthyLayer` et `tmpRoot` par les fixtures. Pour la
couche « DB indisponible », construire le service cassé puis utiliser l'option
`databaseService` :

```ts
import { Database } from "bun:sqlite";

const brokenDatabaseService = (): DatabaseService => {
  const db = new Database(":memory:");
  db.close();
  return {
    ping: Effect.fail(
      new DatabaseError({ message: "simulated database failure" }),
    ),
    sqlite: db,
  };
};
```

Puis `testLayer(tmpRoot(), { databaseService: brokenDatabaseService() })` à la
place de `brokenLayer(...)`. Le helper `buildApp` reçoit la couche
`Layer.Layer<AppContext, never, never>`.

- [x] **Step 5: refactorer `test/runtime.test.ts` sur les fixtures**

Remplacer `tmpRoot`, `makeConfig` et `testLayer` par les fixtures. Le test garde
le même corps (Config, DatabaseService, Telemetry résolus, puis dispose et
ping en échec).

- [x] **Step 6: vérifier**

```text
bun test
bun run typecheck
./node_modules/.bin/biome check --write .
```

Expected: tous les tests existants verts (19 tests lot 1 + ceux des tasks 2-5).

## Task 7 — HTTP : `JobsController`, mapper `PublicError`, filtre

### Files

- Create: `src/http/public-http.exception.ts`
- Create: `src/http/http-exception.filter.ts`
- Create: `src/http/jobs.controller.ts`
- Modify: `src/http/http-error.mapper.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`
- Create: `test/http/jobs.http.test.ts`

- [x] **Step 1: créer l'exception et le filtre**

Créer `src/http/public-http.exception.ts` :

```ts
import { HttpException } from "@nestjs/common";

export class PublicHttpException extends HttpException {
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    response: Record<string, unknown>,
    status: number,
    headers: Readonly<Record<string, string>> = {},
  ) {
    super(response, status);
    this.headers = headers;
  }
}
```

Créer `src/http/http-exception.filter.ts` :

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { PublicHttpException } from "./public-http.exception.js";

@Catch(PublicHttpException)
export class PublicHttpExceptionFilter implements ExceptionFilter {
  catch(exception: PublicHttpException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    for (const [name, value] of Object.entries(exception.headers)) {
      reply.header(name, value);
    }
    reply.status(exception.getStatus()).send(exception.getResponse());
  }
}
```

- [x] **Step 2: réécrire `src/http/http-error.mapper.ts`**

```ts
import { HttpException, HttpStatus } from "@nestjs/common";

import type { DomainError } from "../domain/errors.js";
import type { PublicErrorCode } from "../domain/job.js";
import { PublicHttpException } from "./public-http.exception.js";

const publicError = (
  code: PublicErrorCode,
  message: string,
  status: HttpStatus,
  retryAfterSeconds?: number,
): PublicHttpException => {
  const headers: Record<string, string> = {};
  const body: Record<string, unknown> = { code, message };
  if (retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = retryAfterSeconds;
    headers["Retry-After"] = String(retryAfterSeconds);
  }
  return new PublicHttpException(body, status, headers);
};

export const mapErrorToHttp = (error: DomainError): HttpException => {
  switch (error._tag) {
    case "ConfigError":
      return publicError(
        "CONFIG_ERROR",
        "server configuration is invalid",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    case "DatabaseError":
      return publicError(
        "DB_UNAVAILABLE",
        "database is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case "InvalidRequest":
      return publicError("INVALID_REQUEST", error.message, HttpStatus.BAD_REQUEST);
    case "JobNotCancellable":
      return publicError("JOB_NOT_CANCELLABLE", error.message, HttpStatus.CONFLICT);
    case "JobNotFound":
      return publicError("JOB_NOT_FOUND", `job ${error.id} not found`, HttpStatus.NOT_FOUND);
    case "LimitExceeded":
      return publicError("LIMIT_EXCEEDED", error.message, HttpStatus.PAYLOAD_TOO_LARGE);
    case "QueueFull":
      return publicError(
        "QUEUE_FULL",
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    case "RateLimited":
      return publicError(
        "RATE_LIMITED",
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    default:
      return publicError("UNKNOWN", "unexpected error", HttpStatus.INTERNAL_SERVER_ERROR);
  }
};
```

- [x] **Step 3: créer `src/http/jobs.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Effect } from "effect";
import type { FastifyRequest } from "fastify";

import type { DomainError } from "../domain/errors.js";
import type { Job } from "../domain/job.js";
import { RUNTIME_TOKEN } from "../runtime/managed-runtime.js";
import type { AppRuntime } from "../runtime/managed-runtime.js";
import type { AppContext } from "../runtime/app.layer.js";
import { JobService } from "../services/job.service.js";
import { mapErrorToHttp } from "./http-error.mapper.js";

@Controller("v1/jobs")
export class JobsController {
  private readonly runtime: AppRuntime;

  constructor(@Inject(RUNTIME_TOKEN) runtime: AppRuntime) {
    this.runtime = runtime;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown, @Req() request: FastifyRequest): Promise<Job> {
    return this.execute(JobService.submit(body, request.ip));
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<Job> {
    return this.execute(JobService.get(id));
  }

  @Delete(":id")
  cancel(@Param("id") id: string): Promise<Job> {
    return this.execute(JobService.cancel(id));
  }

  private async execute<R extends AppContext>(
    effect: Effect.Effect<Job, DomainError, R>,
  ): Promise<Job> {
    const result = await this.runtime.runPromise(Effect.either(effect));
    if (result._tag === "Left") {
      throw mapErrorToHttp(result.left);
    }
    return result.right;
  }
}
```

- [x] **Step 4: enregistrer le contrôleur et le filtre**

Dans `src/app.module.ts`, ajouter `JobsController` aux controllers de
`AppModule.forRoot` (import `./http/jobs.controller.js`).

Dans `src/main.ts`, après `app.enableShutdownHooks();`, ajouter :

```ts
    app.useGlobalFilters(new PublicHttpExceptionFilter());
```

avec l'import `import { PublicHttpExceptionFilter } from "./http/http-exception.filter.js";`.

- [x] **Step 5: écrire les tests HTTP**

Créer `test/http/jobs.http.test.ts` :

```ts
import "reflect-metadata";

import { describe, expect, test } from "bun:test";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Layer } from "effect";

import { AppModule } from "../../src/app.module.js";
import { PublicHttpExceptionFilter } from "../../src/http/http-exception.filter.js";
import type { AppContext } from "../../src/runtime/app.layer.js";
import { makeRuntime } from "../../src/runtime/managed-runtime.js";
import { makeTestConfig, testLayer, tmpRoot } from "../fixtures/config.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const HTTP_TOO_MANY = 429;

const validRequest = {
  cfgScale: 7,
  count: 1,
  height: 1024,
  model: "sdxl",
  prompt: "a lighthouse in a storm",
  steps: 30,
  width: 1024,
};

const buildApp = async (
  layer: Layer.Layer<AppContext, never, never>,
  bodyLimit: number,
): Promise<NestFastifyApplication> => {
  const runtime = makeRuntime(layer);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(runtime),
    new FastifyAdapter({ bodyLimit }),
  );
  app.useGlobalFilters(new PublicHttpExceptionFilter());
  await app.init();
  return app;
};

describe("POST /v1/jobs", () => {
  test("accepts a valid request with 201 and a json body", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({ method: "POST", url: "/v1/jobs", payload: validRequest });
    await app.close();
    expect(res.statusCode).toBe(HTTP_CREATED);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body) as { id: string; status: string; cost: number };
    expect(body.id.startsWith("job_")).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.cost).toBe(1024 * 1024 * 30 * 1);
  });

  test("rejects an unknown model with 400", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { ...validRequest, model: "unknown-model" },
    });
    await app.close();
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(JSON.parse(res.body)).toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("rejects dimensions over the configured limits with 413", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { ...validRequest, width: 3000 },
    });
    await app.close();
    expect(res.statusCode).toBe(HTTP_TOO_LARGE);
    expect(JSON.parse(res.body)).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  test("rejects an oversized body before processing", async () => {
    const root = tmpRoot("jobs-http");
    const config = { ...makeTestConfig(root), server: { ...makeTestConfig(root).server, bodyLimitBytes: 1024 } };
    const app = await buildApp(testLayer(root, { config }), 1024);
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { ...validRequest, prompt: "x".repeat(4_000) },
    });
    await app.close();
    expect(res.statusCode).toBe(HTTP_TOO_LARGE);
  });

  test("returns 429 QUEUE_FULL with Retry-After when the queue is full", async () => {
    const root = tmpRoot("jobs-http");
    const config = { ...makeTestConfig(root), queue: { ...makeTestConfig(root).queue, maxQueuedJobs: 2 } };
    const app = await buildApp(testLayer(root, { config }), config.server.bodyLimitBytes);
    const inject = (payload: unknown) =>
      app.inject({ method: "POST", url: "/v1/jobs", payload });
    await inject(validRequest);
    await inject(validRequest);
    const res = await inject(validRequest);
    await app.close();
    expect(res.statusCode).toBe(HTTP_TOO_MANY);
    expect(JSON.parse(res.body)).toMatchObject({ code: "QUEUE_FULL" });
    expect(res.headers["retry-after"]).toBeDefined();
  });

  test("returns 429 RATE_LIMITED after the local limit", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(
      testLayer(root, { rateLimitMaxRequests: 2 }),
      makeTestConfig(root).server.bodyLimitBytes,
    );
    const inject = () => app.inject({ method: "POST", url: "/v1/jobs", payload: validRequest });
    await inject();
    await inject();
    const res = await inject();
    await app.close();
    expect(res.statusCode).toBe(HTTP_TOO_MANY);
    expect(JSON.parse(res.body)).toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("GET /v1/jobs/:id", () => {
  test("returns the job with 200", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const created = await app.inject({ method: "POST", url: "/v1/jobs", payload: validRequest });
    const createdBody = JSON.parse(created.body) as { id: string };
    const res = await app.inject({ method: "GET", url: `/v1/jobs/${createdBody.id}` });
    await app.close();
    expect(res.statusCode).toBe(HTTP_OK);
    expect(JSON.parse(res.body)).toMatchObject({ id: createdBody.id, status: "queued" });
  });

  test("returns 404 JOB_NOT_FOUND for an unknown id", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({ method: "GET", url: "/v1/jobs/job_missing" });
    await app.close();
    expect(res.statusCode).toBe(HTTP_NOT_FOUND);
    expect(JSON.parse(res.body)).toMatchObject({ code: "JOB_NOT_FOUND" });
  });
});

describe("DELETE /v1/jobs/:id", () => {
  test("cancels a queued job and is idempotent", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const created = await app.inject({ method: "POST", url: "/v1/jobs", payload: validRequest });
    const createdBody = JSON.parse(created.body) as { id: string };
    const first = await app.inject({ method: "DELETE", url: `/v1/jobs/${createdBody.id}` });
    const second = await app.inject({ method: "DELETE", url: `/v1/jobs/${createdBody.id}` });
    await app.close();
    expect(first.statusCode).toBe(HTTP_OK);
    expect(JSON.parse(first.body)).toMatchObject({ id: createdBody.id, status: "cancelled" });
    expect(second.statusCode).toBe(HTTP_OK);
    expect(JSON.parse(second.body)).toMatchObject({ id: createdBody.id, status: "cancelled" });
  });

  test("returns 404 for an unknown id", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({ method: "DELETE", url: "/v1/jobs/job_missing" });
    await app.close();
    expect(res.statusCode).toBe(HTTP_NOT_FOUND);
  });

  test("never leaks internal details in error bodies", async () => {
    const root = tmpRoot("jobs-http");
    const app = await buildApp(testLayer(root), makeTestConfig(root).server.bodyLimitBytes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { ...validRequest, model: "unknown-model" },
    });
    await app.close();
    expect(res.body).not.toContain("Error");
    expect(res.body).not.toContain("at ");
  });
});
```

- [x] **Step 6: mettre à jour `test/health.test.ts` pour la forme `PublicError`**

Les erreurs de santé utilisent désormais `PublicHttpException` avec corps
`{ code, message }`. Remplacer l'assertion du test 503 :

```ts
    expect(JSON.parse(res.body)).toEqual({
      code: "DB_UNAVAILABLE",
      message: "database is unavailable",
    });
```

et enregistrer le filtre dans le helper `buildApp` de ce fichier :

```ts
  app.useGlobalFilters(new PublicHttpExceptionFilter());
```

- [x] **Step 7: vérifier**

```text
bun test test/http/jobs.http.test.ts test/http/health.test.ts
bun run typecheck
./node_modules/.bin/biome check --write .
```

Expected: 10 tests HTTP jobs + 3 tests santé verts, typecheck et Biome verts.

## Task 8 — Intégration : durabilité au redémarrage + admission concurrente

### Files

- Create: `test/jobs.integration.test.ts`

- [x] **Step 1: écrire le test d'intégration**

Créer `test/jobs.integration.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";

import { JobService } from "../src/services/job.service.js";
import { JobRepository } from "../src/infra/job.repository.js";
import { makeRuntime } from "../src/runtime/managed-runtime.js";
import { makeTestConfig, testLayer, tmpRoot } from "./fixtures/config.js";

const validRequest = {
  cfgScale: 7,
  count: 1,
  height: 1024,
  model: "sdxl",
  prompt: "a lighthouse in a storm",
  steps: 30,
  width: 1024,
};

describe("jobs integration", () => {
  test("a queued job survives an application restart", async () => {
    const root = tmpRoot("jobs-integration");
    const runtime1 = makeRuntime(testLayer(root));
    const created = await runtime1.runPromise(JobService.submit(validRequest, "client-1"));
    await runtime1.dispose();

    const runtime2 = makeRuntime(testLayer(root));
    const fetched = await runtime2.runPromise(JobService.get(created.id));
    expect(fetched.status).toBe("queued");
    await runtime2.dispose();
  });

  test("a cancelled job stays cancelled after a restart", async () => {
    const root = tmpRoot("jobs-integration");
    const runtime1 = makeRuntime(testLayer(root));
    const created = await runtime1.runPromise(JobService.submit(validRequest, "client-1"));
    const cancelled = await runtime1.runPromise(JobService.cancel(created.id));
    expect(cancelled.status).toBe("cancelled");
    await runtime1.dispose();

    const runtime2 = makeRuntime(testLayer(root));
    const fetched = await runtime2.runPromise(JobService.get(created.id));
    expect(fetched.status).toBe("cancelled");
    await runtime2.dispose();
  });

  test("100 concurrent submissions never exceed the configured capacity", async () => {
    const root = tmpRoot("jobs-integration");
    const config = {
      ...makeTestConfig(root),
      queue: { ...makeTestConfig(root).queue, maxQueuedJobs: 10 },
    };
    const runtime = makeRuntime(testLayer(root, { config }));
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        runtime.runPromise(
          Effect.either(
            JobService.submit(
              { ...validRequest, prompt: `request ${index}` },
              `client-${index % 5}`,
            ),
          ),
        ),
      ),
    );
    const accepted = results.filter((result) => result._tag === "Right");
    const rejected = results.filter((result) => result._tag === "Left");
    expect(accepted.length).toBe(10);
    expect(rejected.length).toBe(90);
    for (const result of rejected) {
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("QueueFull");
      }
    }
    await runtime.dispose();
  });

  test("a claimed job transitions to running with an attempt and a lease", async () => {
    const root = tmpRoot("jobs-integration");
    const runtime = makeRuntime(testLayer(root));
    const created = await runtime.runPromise(JobService.submit(validRequest, "client-1"));
    const claimed = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* JobRepository;
        return yield* repository.claimNext("2030-01-01T00:00:00.000Z", 4);
      }),
    );
    expect(Option.isSome(claimed)).toBe(true);
    if (Option.isSome(claimed)) {
      expect(claimed.value.id).toBe(created.id);
      expect(claimed.value.status).toBe("running");
      expect(claimed.value.attempt).toBe(1);
      expect(claimed.value.leaseUntil).toBe("2030-01-01T00:00:00.000Z");
    }
    await runtime.dispose();
  });
});
```

- [x] **Step 2: vérifier**

```text
bun test test/jobs.integration.test.ts
bun run typecheck
./node_modules/.bin/biome check .
```

Expected: 4 tests verts.

## Task 9 — Documentation, audit et porte de sortie du lot 2

### Files

- Modify: `README.md`
- Modify: `config/platform.example.yaml` (déjà fait au Task 1, vérifier)

- [x] **Step 1: documenter l'API jobs dans le README**

Ajouter dans `README.md`, après la section « État — Lot 1 » :

```markdown
## État — Lot 2 : jobs durables et overload

- API `/v1/jobs` : `POST` (création `queued`), `GET /:id`, `DELETE /:id` ;
- admission bornée : modèle déclaré, dimensions/steps/batch, coût
  (`width * height * steps * count`), taille d'entrée, capacité `maxQueuedJobs` ;
- erreurs structurées `{ code, message, retryAfterSeconds? }` avec
  `Retry-After` sur les 429 (`QUEUE_FULL`, `RATE_LIMITED`) ;
- transitions d'état persistées atomiquement
  (`queued -> running -> succeeded`, `queued|cancelled`, `running -> failed|cancelled`) ;
- claim de job transactionnel (lease, `attempt`) prêt pour le lot 3 ;
- rate limit local en mémoire (60 req/min par IP par défaut).
```

Mettre à jour la liste « Le lot 1 livre » en une liste « Les lots 1 et 2
livrent » ou ajouter un paragraphe « Statut » avant la section Docker.

- [x] **Step 2: audit de typage**

Run :

```text
grep -rn "\bany\b\|@ts-ignore\|as unknown as" src test --include="*.ts" | grep -v "@ts-expect-error"
```

Expected: aucune occurrence non justifiée (le cast `status: row.status as
JobStatus` du repository est documenté et justifié : valeurs écrites par
l'application).

- [x] **Step 3: audit des dépendances**

Vérifier qu'aucune dépendance n'est ajoutée : `bun pm ls` ne doit lister que
celles du lot 1. Aucun ORM, broker, Redis ou CLI ajouté.

- [x] **Step 4: porte finale**

```text
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
docker compose build app
```

Expected: tout vert.

- [x] **Step 5: smoke Docker final**

1. Créer `config/platform.yaml` (auth `none`, `storage.root: /data`, `limits` et
   `models` de l'exemple) puis `docker compose up -d app` ;
2. `curl -X POST http://127.0.0.1:3000/v1/jobs -H 'content-type: application/json' -d '{...}'`
   → 201 `{"status":"queued",...}` ;
3. `curl http://127.0.0.1:3000/v1/jobs/<id>` → 200 `queued` ;
4. `docker compose restart app` ;
5. `curl http://127.0.0.1:3000/v1/jobs/<id>` → toujours `queued` ;
6. `docker compose down`.

Expected: le job survit au redémarrage du conteneur.

## Définition de fin du lot 2

Le lot est terminé uniquement si :

- un job `queued` survit à un redémarrage (tests intégration + smoke Docker) ;
- 100 requêtes concurrentes ne dépassent jamais la capacité configurée
  (`createIfCapacity` atomique, testé) ;
- une requête trop grande est rejetée avant écriture de gros fichiers
  (`bodyLimit` Fastify + `maxInputBytes`, testés) ;
- aucun chemin/URL externe arbitraire n'est accepté (pas de champ de chemin ou
  d'URL dans `JobRequest`) ;
- transitions d'état exhaustives testées, `DELETE` idempotent, 429 avec
  `Retry-After` ;
- format, lint, typecheck, tests et build passent ;
- aucun moteur Stable Diffusion ni broker ajouté.
