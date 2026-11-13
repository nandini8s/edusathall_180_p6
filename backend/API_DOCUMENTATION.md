# Metro Anomaly Reporter API

Base URL for local development: `http://localhost:5000`. The API returns JSON. Report bodies must contain station code, anomaly code, and a 5–2000 character description.

## Demonstration codebook and routing

The required formats are checked independently with a regular expression and a deterministic finite automaton: station `STA[A-Z]{2}[0-9]{3}` and anomaly `A[0-9]{2}`. The sample configurable codebook maps A01 Medical, A02 Safety, A03 Technical, A04 Crowd, and A05 Cleanliness. Other well-formed codes are rejected with `UNKNOWN_ANOMALY_CODE` until mapped in `config/anomalyConfig.js`; the task did not specify the agency codebook. Priority follows category. AB/CD/EF prefixes route to East/West/Central Control Room. Medical reports always route to the Central Emergency Line and Central Control Room. These are demonstration destinations, not real metro contacts. Handler availability and maximum capacity are persisted and managed through the handler API; `config/routingConfig.js` supplies defaults when handler records are first created. If a handler is unavailable or full, reports remain Pending.

On startup, the configured demonstration destinations are initialized as handler records using keys `AB`, `CD`, `EF`, and `MEDICAL`. Persisted availability and capacity settings are not overwritten on restart. Active workload is stored as report IDs on each handler and exposed as `activeReportCount`.

## Endpoints

### `POST /api/anomalies`

Request:

```json
{"stationCode":"STAAB123","anomalyCode":"A01","description":"Passenger needs urgent medical help"}
```

Success (`201`): `{"success":true,"data":{...report}}`. The report includes `stationCode`, `anomalyCode`, `category`, `priority`, `description`, `corridor`, `destination`, `status`, `isValid`, `validationResult`, `createdAt`, and `updatedAt`; it also includes `handlerKey` and `handlerId` for dynamic assignment tracking (`handlerId` is absent while Pending). Invalid codes or description return `422`; unknown configured codes/routes return `422`.

### `GET /api/anomalies`

Optional filters: `category`, `priority`, `status`; pagination: `page` (default 1), `limit` (default 20, maximum 100). Success: `{"success":true,"data":[...],"pagination":{"page":1,"limit":20,"total":0,"pages":0}}`. Invalid filter values or non-positive/non-integer pagination values return `422`.

### `GET /api/anomalies/:id`

Success: `{"success":true,"data":{...report}}`. Invalid Mongo ID returns `400`; missing report returns `404`.

### `PATCH /api/anomalies/:id/status`

Request: `{"status":"In Progress"}`. Allowed transitions: Pending → Assigned → In Progress → Resolved. Success returns the updated report in `data`. Unsupported status returns `422`; an invalid transition or unavailable handler assignment returns `409`.

### `GET /api/anomalies/stats`

Success: `{"success":true,"data":{"total":0,"byCategory":{},"byPriority":{},"byStatus":{}}}`.

### `GET /api/health`

Success when MongoDB is connected (`200`): `{"success":true,"data":{"backend":"healthy","database":"connected"}}`. Database disconnected/connecting returns `503` with its state.

### `GET /api/handlers`

Returns configured handlers, availability, maximum capacity, active report IDs, and the derived active count:

```json
{"success":true,"data":[{"key":"AB","corridor":"East Control Room","destination":"East Control Room","available":true,"maxCapacity":10,"activeReportIds":[],"activeReportCount":0}]}
```

Handler keys are limited to the existing demonstration routes: `AB`, `CD`, `EF`, and `MEDICAL`.

### `PATCH /api/handlers/:key`

Updates a handler's `available` boolean and/or `maxCapacity` non-negative integer. For example: `{"available":false}` or `{"maxCapacity":12}`. Unknown keys return `404 HANDLER_NOT_FOUND`; malformed updates return `422 INVALID_HANDLER_UPDATE`; lowering capacity below current active workload returns `409 HANDLER_CAPACITY_BELOW_WORKLOAD`. The endpoint does not alter corridor, destination, or category eligibility.

## Assignment and capacity lifecycle

- Creating a report writes the report and attempts capacity reservation in one MongoDB transaction. An available handler with room receives the assignment and the report status is `Assigned`. If the handler is unavailable or full, the report is still created as `Pending` with its configured corridor and destination; no capacity is reserved.
- `Pending → Assigned` uses the same atomic capacity reservation. If it fails, the API returns `409 HANDLER_UNAVAILABLE`; the report remains Pending and handler workload is unchanged.
- `Assigned` and `In Progress` reports occupy a slot. Transitioning to `Resolved` removes the report ID from its handler in the same transaction as the report update.
- Reservation is an atomic conditional update requiring the handler to be available, the report ID not already to be reserved, and active workload below `maxCapacity`. MongoDB transactions keep handler and report changes consistent. The MongoDB deployment must support transactions, such as a replica set or sharded cluster.
- On startup, previously active reports without handler links are reconciled to their configured handler and counted. Existing active assignments are recorded even if they exceed a newly configured maximum; further assignments remain blocked until the workload is below that maximum.

## Error format

Errors use `{"success":false,"error":{"code":"...","message":"..."}}`; validation errors may include `details`. Production responses do not include stack traces. CORS allows `http://localhost:5173` and `http://localhost:5174` by default; configure a comma-separated allowlist with `CORS_ORIGINS` when overriding the defaults.
