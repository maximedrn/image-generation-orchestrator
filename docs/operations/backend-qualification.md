# Qualification des backends

## Objectif

Les profils Docker CPU, CUDA, ROCm et Vulkan sont des **implémentations** reproductibles. Une certification de performance ou de compatibilité GPU exige cependant d'exécuter l'image sur le matériel et le driver réellement visés. Ce document définit la même procédure pour chaque release afin de ne jamais confondre « buildable » et « qualifié ».

## Matrice de release

| Backend | Profil | Construction CI générique | Exécution matérielle requise | Statut du dépôt |
| --- | --- | --- | --- | --- |
| CPU x64/ARM64 | `cpu` | oui | oui pour benchmark | implémenté |
| NVIDIA CUDA | `cuda` | image dédiée | oui, runner NVIDIA | implémenté, qualification à renseigner |
| AMD ROCm | `rocm` | image dédiée | oui, runner AMD/ROCm | implémenté, qualification à renseigner |
| Vulkan Intel/AMD/NVIDIA | `vulkan` | image dédiée | oui, device Vulkan | implémenté, qualification à renseigner |
| Apple Metal | `external` | application seulement | oui, `sd-server` natif macOS | implémenté via moteur externe |

Aucune ligne ne doit être promue à « qualifiée » uniquement parce que l'image Docker se construit.

## Procédure commune

Pour chaque couple backend/modèle retenu en release :

1. reconstruire l'image sans cache ;
2. démarrer le profil avec un modèle de qualification connu ;
3. attendre la readiness moteur puis la readiness plateforme ;
4. soumettre un job minimal, attendre son état terminal et télécharger le résultat ;
5. soumettre plusieurs jobs jusqu'à `maxRunningJobs` et confirmer le backpressure ;
6. annuler un job queued puis un job running ;
7. redémarrer l'application pendant un job bound et confirmer la reprise du même `remoteJobId` ;
8. relever RAM, VRAM, durée, versions driver/runtime et commit `stable-diffusion.cpp` ;
9. archiver les logs et le résultat dans les artefacts de release.

## NVIDIA / Windows

Sous Windows, utiliser WSL2 + Docker Desktop ou une distribution Linux WSL2 disposant du support GPU NVIDIA. La preuve de qualification doit enregistrer au minimum la version du driver Windows, la version WSL, `nvidia-smi` dans le contexte conteneur et la VRAM maximale observée.

## AMD / Linux

Pour ROCm, vérifier l'accès réel à `/dev/kfd` et `/dev/dri` ainsi que les groupes `video`/`render`. En cas d'incompatibilité ROCm connue sur le matériel ciblé, le profil Vulkan constitue un fallback distinct ; il doit être qualifié séparément et non présenté comme équivalent en performance.

## Intel / Vulkan

Le profil Vulkan doit être testé avec le driver Mesa/Vulkan de la distribution cible. La simple présence de `/dev/dri` permet l'auto-sélection mais ne prouve ni l'existence d'un ICD Vulkan fonctionnel ni la compatibilité du modèle.

## Apple Silicon

Le moteur tourne nativement sur macOS pour utiliser Metal. Le conteneur Linux héberge seulement l'orchestrateur et joint `host.docker.internal`. La qualification doit donc porter à la fois sur le binaire natif `sd-server` et sur le chemin réseau conteneur -> hôte.

## Mesures à conserver

Pour chaque exécution qualifiée, conserver : date, OS/kernel, CPU, GPU, driver, runtime GPU, architecture, backend, modèle/quantification, résolution, steps, batch, temps total, pic RSS application, pic RSS moteur, pic VRAM, résultat de l'annulation et résultat du test de reprise.
