# Safe AI Mailroom

Public HTTPS serverless endpoint for the `ga5-mailroom-action-gate/v2` propose/commit contract.

- POST `/api` with `operation: "propose"` to return one evidence-backed proposal per dossier.
- POST `/api` with `operation: "commit"` to verify every Ed25519 receipt before recording outcomes.
- Evaluation records and stable proposal cache use a private Vercel Blob store.
- A commit is only marked executed when its signature verifies and the receipt has `accepted: true`.

Request bodies and private evaluation state should contain synthetic exam cases only.
