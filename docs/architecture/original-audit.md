# Audit du projet d'origine

## Synthèse

Le prototype initial avait une idée d'architecture correcte — NestJS comme façade, Effect comme cœur, queue SQLite et futur `stable-diffusion.cpp` — mais l'implémentation s'était arrêtée après le lot 2 alors que la documentation décrivait déjà un système bien plus ambitieux. Continuer incrémentalement aurait figé des couplages et multiplié les exceptions de conception.

## Problèmes constatés

### Écart documentation / réalité

Le README annonçait explicitement seulement les lots 1 et 2. Les lots 3 à 5 du roadmap prévoyaient encore : moteur réel, dispatcher, récupération, résultats, multi-instance, circuit breaker, sécurité production, profils GPU, runbooks et release. La documentation cible était donc en avance de plusieurs lots sur le code.

### Abstractions insuffisantes

Les premières spécifications parlaient de `EngineClient` et de SQLite comme composants directs. Cela rendait la migration vers ComfyUI, PostgreSQL ou MySQL plus coûteuse qu'elle ne devait l'être. La reconstruction remplace ces dépendances par des ports métier provider-neutral.

### Frontières de protocole

Les DTOs natifs d'un moteur (`b64_json`, statuts distants, paramètres d'échantillonnage) ne doivent jamais devenir le contrat du dispatcher. Le nouveau `EngineGateway` effectue ce découplage ; seul l'adaptateur `stable-diffusion.*` connaît le protocole `/sdcpp/v1`.

### Résilience incomplète

Un lease expiré récupéré uniquement au bootstrap ne suffit pas : un worker peut mourir alors que le processus reste vivant. La récupération est désormais périodique et reprend un job distant existant lorsque son identifiant est durablement connu.

L'audit du refactor a également révélé trois courses/invariants qui n'étaient pas protégés par la conception initiale :

- une annulation pouvait croiser la transition `queued` vers `running` ; elle est maintenant réalisée par une transition repository atomique ;
- un worker ayant perdu sa lease pouvait encore annuler un job distant déjà durablement lié ; le fencing coupe désormais ses appels upstream sans toucher au travail repris par le nouveau propriétaire ;
- le rate limiter pouvait dépasser sa borne de buckets suivis lors d'une admission concurrente ; l'éviction est maintenant effectuée avant l'insertion et couverte par un test de capacité stricte.

### Exploitation incomplète

Le prototype n'avait pas encore la matrice CPU/CUDA/ROCm/Vulkan ni le mode Metal externe, et ne proposait pas de chemin de release exécutable. Ces éléments font maintenant partie du dépôt.

### Qualité et conventions

Le projet reconstruit impose :

- imports absolus ;
- signatures publiques explicites ;
- fichiers spécialisés et nommés par responsabilité ;
- TSDoc des classes, méthodes et fonctions nommées ;
- limites de taille de fichiers/fonctions ;
- audits architecturaux ;
- tests unitaires et intégration de repository/dispatcher ;
- erreurs typées et mapping HTTP stable.

## État des lots historiques après reconstruction

| Lot | Intention historique | État du prototype | État de la reconstruction |
| --- | --- | --- | --- |
| 1 | Fondation Bun / NestJS / Effect | Réalisé, mais encore fortement couplé | Reconstruit sur un bootstrap Nest minimal, runtime Effect injectable et configuration stricte |
| 2 | Jobs durables / surcharge | Réalisé partiellement | Repository durable, capacité atomique, annulation, résultats et tests de concurrence |
| 3 | Moteur réel / dispatcher | Non réalisé | Adaptateur `stable-diffusion.cpp`, submit/poll/cancel, binding distant, récupération de lease et stockage de résultats |
| 4 | Multi-moteur / résilience / sécurité | Non réalisé | Pool least-loaded, backpressure, circuit breaker, auth bearer, rate limiting borné, health/readiness/metrics |
| 5 | Hardware / exploitation / release | Non réalisé | CPU/CUDA/ROCm/Vulkan, mode externe Metal, auto-détection, hardening Docker, runbooks et exécutable Bun MUSL |

La reconstruction ne prétend pas supporter plusieurs orchestrateurs actifs en parallèle par défaut : ce scénario requiert un repository partagé, un fencing distribué et un rate limiter distribué. La notion « multi-instance » livrée ici concerne plusieurs moteurs d'inférence derrière un orchestrateur.

## Mesures de structure

Sur l'arbre audité :

- prototype : 28 fichiers TypeScript (`src` + `test`) et 96 imports relatifs ;
- reconstruction : 98 fichiers TypeScript (`src` + `test` + `scripts`) et 0 import relatif ;
- 16 fichiers de tests et 40 cas de tests déclarés ;
- aucun fichier TypeScript ne dépasse 300 lignes non vides ; le maximum mesuré est 265 lignes.

Ces nombres décrivent la structure de l'arbre livré ; ils ne sont pas utilisés comme substitut à l'exécution de la suite de tests.

## Décision de reconstruction

Le résultat conserve les intentions utiles du prototype et les documents historiques sous `docs/legacy`, mais repart d'un squelette NestJS minimal et reconstruit le graphe Effect autour de ports. Les documents historiques sont une source de traçabilité, pas la documentation normative du système courant.
