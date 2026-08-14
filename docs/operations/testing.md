# Validation et tests

## Porte de sortie

```sh
bun install
# commiter le bun.lock produit par Bun pour figer la résolution
bun run verify
bun run build
bun run build:musl
```

`verify` exécute format, lint, typecheck, audit d'architecture, politique interne et tests Bun. Le typecheck utilise TypeScript 7 ; `@typescript/typescript6` est une dépendance de tooling isolée, réservée aux scripts AST, car le projet ne doit pas rétrograder son compilateur applicatif pour satisfaire une API programmatique de tooling.

## Couverture fonctionnelle

La suite teste notamment :

- décodage de configuration et résolution des secrets ;
- repository SQLite et opérations durables ;
- validation/coût/états des jobs ;
- admission via `JobService` ;
- rate limit ;
- comparaison de secret et auth ;
- scheduling/circuit breaker ;
- routage provider-neutral du gateway ;
- récupération d'un job running et reprise via `remoteJobId` ;
- stockage de résultats ;
- mapping des erreurs HTTP et redaction ;
- helpers de paramètres HTTP.

## Tests moteur réels

Les tests unitaires ne téléchargent pas de modèle lourd et ne supposent aucun GPU. Les smoke tests de `sd-server` doivent être exécutés dans l'environnement de release avec un modèle volontairement fourni par l'opérateur. Le même code applicatif doit fonctionner avec CPU, CUDA, ROCm ou Vulkan ; seuls les profils moteur changent.

## CI

GitHub Actions utilise la version de Bun définie dans `.bun-version`, `actions/checkout@v7.0.1` et `oven-sh/setup-bun@v2.2.0`, exécute `bun run verify`, valide `docker compose config` et construit les images applicatives Bun et MUSL. Les images GPU complètes sont volontairement mieux validées dans une CI hardware dédiée, car un runner CPU générique ne peut pas prouver l'exécution CUDA/ROCm/Vulkan.


## Reproductibilité des dépendances

Le dépôt reconstruit ne réutilise pas le `bun.lock` du prototype, car il correspondait à un graphe de dépendances antérieur. Après le premier `bun install` avec la version de `.bun-version`, commiter le nouveau `bun.lock`, puis remplacer les installations de release/CI par `bun install --frozen-lockfile`. Un lockfile fabriqué manuellement ou copié depuis le lot 2 donnerait une fausse reproductibilité.
