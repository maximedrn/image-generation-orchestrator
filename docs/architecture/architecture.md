# Architecture finale

## Vue d'ensemble

La plateforme suit une architecture hexagonale légère : NestJS/Fastify est l'adaptateur entrant, Effect porte le métier et l'orchestration, et les dépendances externes sont derrière des ports injectés par `Layer`.

```text
HTTP / NestJS / Fastify
        |
        v
 HttpEffectService
        |
        v
+-----------------------------+
| Effect application runtime  |
|                             |
| JobService                  |
| Dispatcher                  |
| EnginePool                  |
| RateLimiter                 |
| SecurityService             |
+-----------------------------+
   |          |          |
   v          v          v
JobRepository EngineGateway ResultStorage
   |          |          |
 SQLite      stable-     local atomic
(default)    diffusion   files
             .cpp
```

## Frontière NestJS

NestJS est volontairement limité à la frontière HTTP. Le CLI Nest sert uniquement à reproduire le scaffold initial ; les commandes de build/dev/runtime passent par Bun et le typecheck par TypeScript 7, afin de ne pas coupler le projet à l'API Compiler programmatique du CLI.

- construire le serveur Fastify ;
- appliquer les guards/filtres ;
- traduire HTTP vers des effets ;
- démarrer/arrêter le `ManagedRuntime` Effect.

Les controllers ne contiennent ni SQL, ni logique de scheduling, ni protocole moteur.

## Runtime Effect

`createAppRuntime(config, adapters)` construit un seul `ManagedRuntime`. La composition par défaut fournit :

- configuration validée ;
- SQLite ;
- repository de jobs ;
- rate limiter ;
- authentification ;
- pool de moteurs ;
- gateway moteur ;
- stockage de résultats ;
- service métier de jobs ;
- dispatcher supervisé.

`RuntimeAdapterLayers` permet de remplacer les trois dépendances d'infrastructure majeures sans modifier le métier.

## Queue durable

Un job accepté est persisté avant d'être visible comme `queued`. Le dispatcher :

1. regarde la tête de queue ;
2. réserve un moteur compatible ;
3. effectue un claim transactionnel respectant `maxRunningJobs` ;
4. soumet le job au moteur ;
5. persiste son `remoteJobId` ;
6. poll le moteur ;
7. stocke atomiquement les résultats ;
8. effectue la transition terminale ;
9. libère la capacité moteur.

La phase 4 est une frontière de durabilité : après acceptation distante, le binding du `remoteJobId` est réessayé sans remettre le job en queue. Après binding, une panne locale ou de polling diffère le travail vers la récupération de lease au lieu de créer une seconde génération. Si le renouvellement de lease échoue ou que le job n’est plus `running`, le worker cesse tout appel upstream. Voir [Durabilité et sémantique de reprise](durability.md).

Les leases empêchent un job `running` de rester bloqué indéfiniment. La récupération est effectuée au démarrage et périodiquement selon `recoveryIntervalSeconds`. Si un `remoteJobId` existe encore, le dispatcher reprend le polling au lieu de soumettre une génération identique.

## Scheduler multi-moteur

`EnginePool` maintient un état runtime par instance : charge courante, échecs consécutifs, santé et fin de cooldown. Une réservation :

- filtre les moteurs capables de servir le modèle ;
- exclut ceux sans capacité ou circuit ouvert ;
- choisit le moins chargé ;
- incrémente la réservation atomiquement dans l'état Effect.

La limite globale de jobs running est indépendante des capacités par moteur et reste garantie par le repository durable.

## Erreurs

Les erreurs applicatives sont des valeurs Effect explicites (`Data.TaggedError`). La frontière HTTP les mappe vers des codes stables sans exposer les causes internes. Les erreurs d'infrastructure sont systématiquement redacted.

## Typage

Les contrats publics et les ports ont des types explicites. Les entrées non fiables restent `unknown` jusqu'au décodage. Les variables locales de production, callbacks, fonctions et méthodes nommés déclarent explicitement leurs types ; les objets de constantes littérales utilisent `as const` pour préserver volontairement leurs unions de littéraux. Aucun `any`, import relatif ou double cast `unknown` n'est accepté par la politique de projet.

## Persistance

SQLite est un adaptateur par défaut, pas le modèle du domaine. Il utilise WAL, busy timeout et migrations idempotentes. Les opérations de queue qui doivent être atomiques restent encapsulées derrière `JobRepository`.

## Contrat public

Le DTO HTTP de job est distinct du modèle persistant. Les identifiants moteur, `remoteJobId`, lease, coût scheduler et messages upstream bruts ne quittent pas la couche applicative. Les résultats ne deviennent publiquement adressables qu’après transition durable vers `succeeded`.

## Résultats

`ResultStorage` reçoit des résultats provider-neutral. L'adaptateur local :

- décode le base64 ;
- calcule SHA-256 ;
- écrit un fichier temporaire ;
- renomme atomiquement vers sa destination ;
- supprime en best-effort le fichier temporaire si la publication échoue ;
- persiste ensuite les métadonnées ;
- expose un stream au controller HTTP.

La mémoire du processus n'a donc pas besoin de charger un fichier complet lors de sa lecture HTTP.


## Limite mémoire du protocole moteur

L’API asynchrone native de `stable-diffusion.cpp` retourne actuellement l’image terminée en base64. L’adaptateur est donc obligé de matérialiser ce payload lors de la réponse moteur avant de le convertir en octets. La plateforme borne cette exposition via `maxBatch`, `maxPixels`, `maxRunningJobs` et `maxConcurrent`, puis écrit immédiatement le résultat et le sert ensuite en streaming. Une future implémentation `EngineGateway` capable de renvoyer une URL ou un stream pourra supprimer cette matérialisation sans modifier le métier.

## Topologie de déploiement

Le scheduler sait piloter plusieurs moteurs en parallèle. Le dépôt par défaut conserve un seul orchestrateur `app`. La réplication active/active de plusieurs orchestrateurs demanderait un fencing de lease et des services distribués supplémentaires ; elle n’est pas implicitement promise par l’utilisation de leases SQLite.
