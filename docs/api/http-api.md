# API HTTP

## Authentification

Avec `security.auth: bearer`, toutes les routes métier et de résultats exigent :

```http
Authorization: Bearer <token>
```

La valeur du token provient exclusivement de la variable d'environnement désignée par `security.apiKeyEnv`. Les endpoints de liveness/readiness restent destinés à l'exploitation du service.

## Créer un job

`POST /v1/jobs`

Corps :

```json
{
  "cfgScale": 7,
  "count": 1,
  "height": 1024,
  "model": "default",
  "negativePrompt": "optional",
  "outputFormat": "png",
  "prompt": "a lighthouse in a storm",
  "seed": 42,
  "steps": 30,
  "width": 1024
}
```

Champs optionnels : `negativePrompt`, `outputFormat`, `seed`. Les autres champs sont obligatoires et aucune valeur métier implicite n'est appliquée par l'API publique.

Réponse `201` :

```json
{
  "cancelRequested": false,
  "createdAt": "2026-08-14T12:00:00.000Z",
  "error": null,
  "id": "<uuid>",
  "request": { "...": "validated request" },
  "resultUrls": [],
  "status": "queued",
  "updatedAt": "2026-08-14T12:00:00.000Z"
}
```

Les champs internes `cost`, `engineId`, `remoteJobId`, `leaseUntil`, `attempt` et les messages upstream bruts ne font pas partie du contrat public.

## Lire un job

`GET /v1/jobs/:id`

Retourne le même DTO public avec l'état durable courant. Les `resultUrls` ne sont renseignées que lorsque `status` vaut `succeeded`.

Un job `failed` retourne une erreur métier redacted :

```json
{
  "error": {
    "code": "GENERATION_FAILED",
    "message": "image generation failed"
  }
}
```

Les détails d'infrastructure restent dans les logs/opérations et ne sont pas sérialisés vers le client.

## Annuler un job

`DELETE /v1/jobs/:id`

- `queued` : transition durable immédiate vers `cancelled` ;
- `running` : `cancelRequested` est persisté puis le dispatcher appelle le moteur ;
- état terminal : `409 JOB_NOT_CANCELLABLE`.

Réponse nominale : `202`.

## Lire un résultat

`GET /v1/jobs/:id/results/:index`

Le résultat n'existe publiquement que lorsque le job est `succeeded`. La réponse est streamée depuis `ResultStorage` avec `Content-Type`, `Content-Length`, `ETag` et une politique de cache explicite.

## Moteurs et observabilité

- `GET /v1/engines` : vue provider-neutral de la capacité et de la santé des moteurs ;
- `GET /v1/metrics` : métriques bornées de queue et de scheduler ;
- `GET /health/live` : processus vivant ;
- `GET /health/ready` : repository et moteurs nécessaires utilisables.

## Erreurs HTTP

Les erreurs sont des valeurs Effect typées puis traduites à la frontière HTTP. Les catégories d'infrastructure sont redacted. Les principales réponses publiques sont :

- `400 INVALID_REQUEST` ;
- `401 UNAUTHORIZED` ;
- `404 JOB_NOT_FOUND` ;
- `409 JOB_NOT_CANCELLABLE` ;
- `422 LIMIT_EXCEEDED` ;
- `429 QUEUE_FULL` / `RATE_LIMITED` avec `retryAfterSeconds` ;
- `502 ENGINE_PROTOCOL` / `ENGINE_REJECTED` ;
- `503 DATABASE_UNAVAILABLE` / `ENGINE_UNAVAILABLE` / `STORAGE_UNAVAILABLE` / `CONFIGURATION_ERROR` ;
- `500 INTERNAL_ERROR` comme fallback défensif.
