# Project Verification Test Plan

Run the automated suite from `backend/` with `npm test`. The numbered AUD cases below are in `tests/project-audit.test.js`; they test service/controller logic with a fake handler model and transaction session. `npm run test:integration` runs `tests/handlerMongo.integration.test.js` against the configured MongoDB replica set and cleans up its temporary reports/settings. The pre-existing tests in `tests/validation.test.js` remain in the suite.

## Automated cases

| ID | Case | Expected result |
| --- | --- | --- |
| AUD-01 | Canonical station code `STAAB123` | Regex and DFA accept |
| AUD-02 | Station code with surrounding whitespace | Trim then accept |
| AUD-03 | Lowercase station letters | Regex and DFA reject |
| AUD-04 | Short station code | Reject |
| AUD-05 | Wrong `STA` prefix | Reject |
| AUD-06 | Digit in station corridor letters | Reject |
| AUD-07 | Canonical anomaly code `A01` | Regex and DFA accept |
| AUD-08 | Well-formed but unmapped `A99` | Format validation accepts; classification rejects with `UNKNOWN_ANOMALY_CODE` |
| AUD-09 | One-digit anomaly code | Reject |
| AUD-10 | Letter in anomaly digit positions | Reject |
| AUD-11 | Lowercase anomaly prefix | Reject |
| AUD-12 | DFA follows a valid transition path | Accept and return final state |
| AUD-13 | DFA incomplete path and out-of-alphabet symbol | Reject and return `null` for invalid path |
| AUD-14 | A01 classification | Medical / Critical |
| AUD-15 | A02 classification | Safety / High |
| AUD-16 | A03 classification | Technical / Medium |
| AUD-17 | A04 classification | Crowd / Low |
| AUD-18 | A05 classification | Cleanliness / Low |
| AUD-19 | AB station corridor | East Control Room |
| AUD-20 | CD station corridor | West Control Room |
| AUD-21 | EF station corridor | Central Control Room |
| AUD-22 | Unconfigured GH station corridor | `UNKNOWN_STATION_ROUTE` |
| AUD-23 | Medical report submitted from AB corridor | Central Emergency Line / Central Control Room / Assigned |
| AUD-24 | Available handler has room | Reserve the report in active workload |
| AUD-25 | Handler marked unavailable | Refuse reservation and leave active workload unchanged |
| AUD-26 | Handler already at max capacity | Refuse another reservation |
| AUD-27 | Each forward status transition | Allowed |
| AUD-28 | Skipped, repeated, or reopened status transition | Rejected |
| AUD-29 | API request with malformed station and anomaly codes | 422 `INVALID_REPORT`, with Regex/DFA details |
| AUD-30 | Description shorter than five trimmed characters | 422 `INVALID_DESCRIPTION` |
| AUD-31 | Description longer than 2000 characters | 422 `INVALID_DESCRIPTION` |
| AUD-32 | API create request with unmapped anomaly code | 422 `UNKNOWN_ANOMALY_CODE` |
| AUD-33 | API create request with unconfigured station route | 422 `UNKNOWN_STATION_ROUTE` |
| AUD-34 | Medical category route | Reserve against the configured MEDICAL / Central Emergency Line handler |
| AUD-35 | Concurrent requests compete for a capacity of three | Exactly three reservations succeed |
| AUD-36 | Same report is reserved twice | Second reservation fails; active count remains one |
| AUD-37 | A resolved report releases its capacity | Next waiting report can reserve the released slot |
| AUD-38 | Station code with an extra digit | Regex and DFA reject |
| AUD-39 | Update handler availability and max capacity | Settings change without altering active report IDs |
| AUD-40 | Lower capacity below current active workload | Reject update with 409; handler record remains unchanged |
| AUD-41 | Move Pending report to Assigned with available capacity | Reserve handler slot and update report assignment |
| AUD-42 | Move Pending report to Assigned with no eligible handler | Return `HANDLER_UNAVAILABLE`; report remains Pending and is escalated |

## Backup and escalation coverage

`tests/assignmentEscalation.test.js` covers primary available, primary unavailable/full with backup assignment, both unavailable/full, backup capacity reservation, medical backup bypass, history, successful retry, concurrent retry serialization, and finite automatic retry limit. `tests/handlerMongo.integration.test.js` exercises primary workload, backup assignment, escalation, automatic retry after availability change, duplicate retry, and capacity release against the configured replica set.

The live integration test must run with `npm run test:integration` against the configured MongoDB replica set. It creates uniquely tagged temporary reports and restores tested handler settings. It requires idle AB primary and backup demonstration handlers.
