# Metro Anomaly Reporter Project Audit

## Audit basis

The root `README.md` contains only the repository title, so it does not define a full problem statement. This audit uses the project requirements previously supplied in the conversation and the implemented contract in `backend/API_DOCUMENTATION.md`.

## Implemented

| Area | Finding | Evidence |
| --- | --- | --- |
| Station and anomaly validation | Implemented with separate Regex and DFA checks; API returns both results on invalid codes. | `backend/services/validationService.js`, `backend/utils/dfa.js`, controller |
| Classification | Five configured codes map A01–A05 to Medical, Safety, Technical, Crowd, and Cleanliness. Priorities are Critical, High, Medium, Low, and Low. | `backend/config/anomalyConfig.js` |
| Routing | AB/CD/EF prefixes map to East/West/Central Control Room. Medical routes to Central Control Room / Central Emergency Line regardless of station prefix. | `backend/config/routingConfig.js`, `backend/services/routingService.js` |
| Report API and persistence | Create, filtered/paginated list, detail, sequential status update, stats, and health routes are implemented. Reports are stored with Mongoose. | `backend/routes/anomalyRoutes.js`, controller, model |
| Handler availability and capacity | Persistent handler records track availability, maximum capacity, and active report IDs. Reservations use conditional atomic updates; report creation/status changes and workload changes use transactions. | `backend/models/Handler.js`, `backend/services/handlerService.js`, anomaly controller |
| Handler management API | Handler workload can be read and availability/capacity updated while preserving current assignments. | `backend/routes/handlerRoutes.js`, `backend/controllers/handlerController.js` |
| Frontend | Submission, report listing, handler workflow, routing view, and aggregate analytics screens are present and use Axios against the API. | `frontend/src/App.jsx` |

## Partially implemented

| Area | Finding |
| --- | --- |
| Handler management UI | The React routing screen reads handler role/workload and controls availability/max capacity through the API. It does not change configured destinations or eligibility rules. |
| User dashboard | The list endpoint is global and has no identity or user filter, so this is a global report tracker rather than a per-user view. |
| Error and integration coverage | Unit tests cover reservation, primary/backup selection, escalation and retries. Live MongoDB transaction coverage is available through the opt-in replica-set integration test. |

## Missing

| Area | Finding |
| --- | --- |
| Agency-specific codebook | The five mappings are explicitly demonstrative and require approved agency codes before operational use. |

## Recently implemented

Non-medical routes now have configurable, clearly labelled demonstration backup mappings. Assignment tries eligible primary then same-corridor backup handlers, tracks primary/backup role and assignment attempt history, and persists unavailable/full reports in a Pending escalation queue. Operators can list and retry escalations; handler availability/capacity changes and capacity releases trigger bounded automatic retries (maximum eight). Medical remains Critical and bypasses ordinary backups. Routing Management shows primary/backup roles and the escalation queue.

## Scope and implementation note

Handler reservation, escalation retry and status transitions require a MongoDB deployment that supports transactions (replica set or sharded cluster). No official operational mappings were invented; backup mapping values are configurable demonstrations.
