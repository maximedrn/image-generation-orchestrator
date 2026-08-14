# Hardware et Docker

## Stratégie

L'application HTTP/orchestrateur est identique quel que soit le GPU. Seul `sd-server` change de build et de device mapping. Cela évite d'embarquer CUDA/ROCm dans le processus NestJS et protège sa RAM/VRAM.

## CPU

Profil : `cpu`.

Le build `stable-diffusion.cpp` désactive `GGML_NATIVE` pour produire une image plus portable entre CPU. La performance exacte dépend du modèle, de la quantification et du jeu d'instructions disponible.

## NVIDIA CUDA

Profil : `cuda`.

Prérequis hôte : driver NVIDIA compatible et NVIDIA Container Toolkit. Compose demande `gpus: all`; l'application n'accède jamais directement au GPU.

## AMD ROCm

Profil : `rocm`.

Prérequis hôte : pile ROCm compatible. Compose transmet `/dev/kfd` et `/dev/dri` et ajoute les groupes vidéo/render configurables.

## Vulkan

Profil : `vulkan`.

Prérequis hôte : device DRM et driver Vulkan utilisable. Ce profil est une voie générique pour du matériel non couvert par CUDA/ROCm lorsque `stable-diffusion.cpp` le supporte correctement.

## macOS / Apple Silicon / Metal

Docker Desktop ne donne pas au conteneur Linux l'accès au backend Metal natif attendu par `stable-diffusion.cpp`. Le mode correct est donc :

1. compiler/lancer `sd-server` nativement sur macOS avec Metal ;
2. lancer uniquement l'application dans Docker ;
3. utiliser `config/platform.external.yaml`, qui pointe vers `host.docker.internal:8080`.

`scripts/run-auto.sh` sélectionne ce mode sur Darwin.

## RAM et VRAM

Les principales protections côté plateforme sont :

- queue bornée ;
- `maxRunningJobs` global ;
- `maxConcurrent` par moteur ;
- limites de pixels, batch, steps et coût ;
- body HTTP borné ;
- streaming des résultats ;
- moteur séparé du process HTTP ;
- circuit breaker pour éviter les tempêtes de retry.

Le conteneur moteur expose trois réglages actuels sans rebuild :

- `SDCPP_VAE_TILING=true|false` : active le VAE tiling ; `true` est la valeur par défaut du compose pour réduire les pics mémoire du décodage VAE ;
- `SDCPP_BACKEND_PLACEMENT` : valeur transmise à `--backend`, par exemple `diffusion=cuda0,te=cpu,vae=cpu` ;
- `SDCPP_PARAMS_BACKEND` : valeur transmise à `--params-backend` pour contrôler le placement des paramètres.

Ces options sont volontairement injectées dans le service moteur, jamais dans le domaine NestJS/Effect. Les anciens flags spécialisés CPU/clip/VAE ne sont pas utilisés : le placement moderne est centralisé par `--backend` et `--params-backend`.

Le VAE tiling réduit généralement la pression VRAM au prix d’un compromis de performance qui dépend du modèle et du backend. Si la VRAM/RAM est confortable, définir `SDCPP_VAE_TILING=false` permet de mesurer le meilleur compromis sur la machine cible.

### Sélection automatique

`scripts/run-auto.sh` respecte d’abord `ENGINE_BACKEND` lorsqu’il est explicitement défini. Sans override :

1. macOS -> `external` (moteur Metal natif sur l’hôte) ;
2. `nvidia-smi` fonctionnel -> `cuda` ;
3. `/dev/kfd` -> `rocm` ;
4. `/dev/dri` -> `vulkan` ;
5. sinon -> `cpu`.

Cette détection choisit un profil plausible ; elle ne remplace pas la validation du driver, du modèle et de la mémoire disponible. Pour un environnement de production déterministe, fixer explicitement `ENGINE_BACKEND`.


## Qualification de release

La détection automatique ne vaut jamais certification matérielle. La matrice et la procédure de qualification CPU/CUDA/ROCm/Vulkan/Metal sont définies dans [backend-qualification.md](backend-qualification.md).
