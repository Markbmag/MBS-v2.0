# Behaviour recorder (development only)

This folder is **not used by the running server**. It exists so that the server
code can be reorganised while proving that nothing it does has changed.

## What it does

`record.js` starts `server.js` with every outside system replaced by a recorder:

| Real thing                         | Replaced by                                   |
|------------------------------------|-----------------------------------------------|
| 5 MySQL databases                  | fake pools that log each query and its values |
| OPC UA (PLC)                       | a client that never connects                  |
| E-mail (nodemailer)                | logged, never sent                            |
| Timers (`setInterval`, node-cron)  | logged, never fired                           |
| File writes / deletes              | logged, not performed                         |
| `.env`                             | not read                                      |
| Clock, `Math.random`               | frozen time, fixed random sequence            |

It then sends every request from `requests.json` (823 requests covering all
routes) and saves, for each one: the SQL sent to each database with its values,
the HTTP status and response body, file/e-mail side effects, and console output.

`run-all.js` does this under four conditions (day / night clock, empty / filled
query results). `compare.js` reports any difference between two recordings.

Nothing connects to the network or to the plant databases; it can run anywhere.

## Use

From the `server` folder:

```bash
npm run harness:baseline   # once, on the code before a change
npm run harness:verify     # after the change: must print "all conditions identical"
```

Recordings are written to `server/recordings/` (ignored by git).

## Notes

* `requests.json` was generated from the original single-file `server.js` by
  `gen-requests.js` and is committed, so every comparison uses the same input.
  Regenerate it only on purpose (for example after a new route is added).
* A difference is not automatically a bug, but every difference must be
  explained and agreed before it is accepted.
