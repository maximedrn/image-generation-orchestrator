# Rapport de validation du refactor

## Contrôles exécutés dans l'environnement de reconstruction

Les contrôles suivants ne nécessitent ni téléchargement de dépendances ni GPU et ont été exécutés sur l'arbre final :

- parsing AST de 98 fichiers TypeScript (`src`, `test`, `scripts`) : 0 violation structurelle et aucune erreur syntaxique ;
- audit des signatures : paramètres et retours explicitement typés ;
- audit TSDoc : fonctions/méthodes/classes nommées documentées avec `@param` et `@returns` lorsque requis ;
- aucun type explicite `any` ;
- aucune assertion non-null ;
- aucun import TypeScript relatif ;
- aucun `process.env` dans les sources ;
- aucun marqueur de travail différé dans les sources ;
- aucun fichier TypeScript au-delà de 300 lignes non vides ; maximum mesuré : 265 lignes ;
- syntaxe shell des scripts Docker/auto-détection valide ;
- parsing JSON de `package.json`, `tsconfig.json` et `biome.json` ;
- parsing YAML des configurations et fichiers Compose.

## Contrôles qui doivent tourner sous Bun

Le sandbox de reconstruction ne fournit ni Bun ni Docker et son accès registry depuis le shell est bloqué. Il serait donc trompeur d'annoncer l'exécution locale de `bun install`, Biome, TypeScript 7, Bun Test ou des builds Docker.

Sur une machine de validation disposant de Bun `1.3.14` et d'un accès registry :

```sh
bun install
bun run verify
bun run build
bun run build:musl
```

Puis, avec Docker :

```sh
PLATFORM_API_KEY=ci-placeholder docker compose config --quiet
docker build -f docker/app.Dockerfile -t stable-diffusion-platform:validation .
docker build -f docker/app-musl.Dockerfile -t stable-diffusion-platform:musl-validation .
```

Après la première résolution réussie, commiter le `bun.lock` produit par Bun et utiliser `bun install --frozen-lockfile` en CI/release.

## Tests ajoutés pour les invariants critiques

Le dépôt contient 16 fichiers de tests et 40 cas de tests déclarés. Cette mesure confirme la présence de la matrice de tests ; elle ne prétend pas que les tests ont été exécutés dans ce sandbox.

La suite couvre notamment : admission concurrente bornée, claim concurrent borné par `maxRunningJobs`, annulation atomique pendant la transition queued/running, limite RAM du rate limiter, reprise d'un job remote-bound et fencing de lease empêchant un worker ayant perdu sa lease d'annuler le travail distant légitime d'un autre worker.

## Validation hardware

CPU/GPU réels et modèles lourds ne sont volontairement pas simulés. La procédure de preuve est décrite dans `backend-qualification.md`; une matrice de release doit être remplie sur les runners matériels réellement supportés.
