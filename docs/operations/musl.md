# Build Bun / MUSL

## Ce que fait le build

`bun run build:musl` utilise `bun build --compile` pour créer un exécutable Linux contenant le bundle applicatif et une copie du runtime Bun. Le code TypeScript n'est pas traduit en C ou C++.

Les optimisations activées sont :

- minification ;
- bytecode précompilé ;
- argument runtime `--smol` ;
- cible Linux MUSL ;
- cible `bun-linux-x64-musl-baseline` sur x64 pour maximiser la compatibilité CPU ;
- cible `bun-linux-arm64-musl` sur ARM64 ;
- auto-chargement `.env` et `bunfig` désactivé dans le binaire compilé pour conserver une configuration runtime explicite.

Bun documente des cibles MUSL x64/ARM64 et une variante x64 `baseline` pour les CPU sans AVX2. Le script sélectionne `bun-linux-x64-musl-baseline` sur x64 et `bun-linux-arm64-musl` sur ARM64. Le build peut être surchargé avec `BUN_MUSL_TARGET` en CI pour produire une autre cible **documentée et supportée par Bun**. Le script refuse une architecture hôte autre que x64/ARM64 lorsqu’aucune cible explicite n’est fournie. La compatibilité CPU du moteur d'inférence est gérée séparément par le build `stable-diffusion.cpp` et ne doit pas être confondue avec la cible du processus d'orchestration.

## Pourquoi pas TypeScript vers C/C++

Une transformation générale d'une application NestJS/Effect vers du C/C++ n'existe pas sans réécrire les bibliothèques et leur runtime. Elle détruirait précisément l'écosystème demandé et ne constituerait pas une optimisation sûre.

L'exécutable Bun est le compromis pertinent : le parsing/transpiling est déplacé au build, le runtime Bun est embarqué dans l’exécutable et l’image runtime peut être basée sur Alpine sans embarquer l’arbre `node_modules` applicatif. Le moteur d’inférence reste, lui, du C/C++ natif via `stable-diffusion.cpp`.

## Limite importante

Une cible MUSL Bun n'est pas synonyme d'exécutable entièrement statique autonome sur toute distribution Linux. L'image fournie utilise Alpine et fournit donc le loader/runtime MUSL attendu. Il ne faut pas promettre un binaire C statique universel.

## Commandes

```sh
bun run build:musl
./dist/stable-diffusion-platform
```

Via Docker :

```sh
docker build -f docker/app-musl.Dockerfile -t stable-diffusion-platform:musl .
```
