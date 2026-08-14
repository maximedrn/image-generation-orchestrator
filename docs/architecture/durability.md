# Durabilité et sémantique d'exécution

## Objectif

Le dispatcher doit éviter les doubles générations tout en restant récupérable après une panne locale. La difficulté principale est la frontière entre l'acceptation d'un job par le moteur distant et la persistance de son identifiant dans le repository.

## Phases de sécurité

### 1. Avant soumission distante

Un job `queued` est claimé transactionnellement en `running` avec une lease et un compteur `attempt`. Tant qu'aucun moteur n'a accepté le travail, un échec de soumission peut appliquer la politique de retry bornée par `maxAttempts`.

Dans cette phase seulement, le job peut revenir en `queued` sans risque de dupliquer un travail distant déjà accepté.

### 2. Après acceptation distante, avant binding durable

Dès que `EngineGateway.submit` retourne un `EngineSubmission.id`, le dispatcher change de règle : il ne doit plus remettre le job en queue sur une simple panne locale.

`bindSubmittedJob` réessaie donc la persistance de `(engineId, remoteJobId, leaseUntil)` avec un délai explicite basé sur `recoveryIntervalSeconds`. Tant que le processus reste vivant, une indisponibilité temporaire de la base ne provoque pas de seconde soumission.

Si la fibre est interrompue proprement avant la fin du binding, un cleanup `Effect.onInterrupt` tente d'annuler le job distant en best-effort.

### 3. Après binding du `remoteJobId`

Une fois l'identifiant distant durable :

- une panne de polling ne remet jamais le job en queue ;
- une panne de base ou de stockage ne supprime jamais le `remoteJobId` pour déclencher une nouvelle soumission ;
- un seuil de circuit breaker atteint interrompt le polling courant et laisse la récupération par lease reprendre le même job distant ;
- si le job local n'est plus `running` ou si le renouvellement de lease échoue, le worker arrête tout appel upstream ;
- la récupération utilise toujours le `remoteJobId` existant au lieu de soumettre une nouvelle génération.

Cette séparation est volontaire : `retryOrFailJob` est une opération **pré-soumission**, tandis que les incidents post-soumission sont différés vers la récupération durable.

## Fenêtre résiduelle non éliminable côté client

Le protocole asynchrone natif actuellement utilisé accepte une soumission puis retourne un identifiant distant, mais le contrat documenté n'expose pas de clé d'idempotence fournie par le client.

Il existe donc une fenêtre très courte impossible à fermer uniquement côté orchestrateur :

```text
moteur accepte le job
        |
        | hard kill / perte machine
        v
remoteJobId pas encore persisté
```

Après un crash brutal exactement dans cette fenêtre, l'orchestrateur ne peut pas prouver si le moteur a accepté le travail. Il peut alors rester un job distant orphelin ou, après expiration de lease, une nouvelle soumission peut être nécessaire.

Le projet ne prétend donc pas fournir un « exactly once » distribué absolu. Il fournit une protection forte contre les doubles soumissions dès que l'identifiant distant est durable, et un cleanup best-effort sur interruption gracieuse. Pour supprimer complètement cette fenêtre, le fournisseur moteur doit supporter une clé d'idempotence ou un identifiant de job imposé par le client.

## Publication atomique des résultats

Pour un résultat réussi :

1. chaque image est écrite vers un fichier temporaire puis renommée atomiquement ;
2. les fichiers déjà publiés sont suivis pendant le batch ;
3. si l'écriture d'un élément échoue, les fichiers du batch déjà écrits sont supprimés en best-effort ;
4. toutes les métadonnées sont persistées dans une transaction repository ;
5. si cette transaction échoue, les fichiers publiés sont nettoyés en best-effort ;
6. le job n'est transitionné vers `succeeded` qu'après la persistance du batch.

Le DTO public n'expose aucune URL de résultat tant que le job n'est pas durablement `succeeded`, même si des métadonnées intermédiaires existent pendant une reprise. L'endpoint binaire applique la même règle.

## Topologie supportée

Le lot « multi-instance » du roadmap historique signifie **plusieurs instances de moteur d'inférence** derrière un orchestrateur : capacité par moteur, least-loaded, circuit breaker, modèles/capabilities et limite globale.

La réplication horizontale de plusieurs processus `app` actifs n'est pas annoncée comme une garantie du dépôt actuel. Pour la supporter correctement, une implémentation future doit ajouter au contrat durable un mécanisme de fencing/ownership de lease, utiliser une base adaptée au partage inter-processus (par exemple PostgreSQL/MySQL) et remplacer le rate limiter local par un backend distribué.
