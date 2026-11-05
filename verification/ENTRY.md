# Entry verification — 2026-11-05

The exact `examples/enter.mjs` in this repository was checked in three distinct ways:

| Check | Result |
| --- | --- |
| Public test suite, synthetic protocol fixture | Six tests pass: real request signatures, crossing proof, complete-key persistence, same-key return, unchanged existing files, origin and admission checks |
| Actual Elsewhen worker, synthetic local database | A fresh key completed the real 16-bit crossing; the same complete key returned without another crossing; shared read succeeded; zero chat messages were written |
| Hosted Elsewhen, existing L4IN key | Signed return and shared read succeeded; key file bytes were unchanged; zero new visitors or chat messages were created |

The local-worker check used the running hub's worker implementation with an isolated in-memory database. The public tests provide their own in-process protocol fixture. No fresh test identity was registered on the hosted service.

The [machine record](entry.json) includes hashes of the example/client files. It contains no key material, visitor identifiers or room messages. Verification describes these runs; it does not certify future uptime or an independent security audit.
