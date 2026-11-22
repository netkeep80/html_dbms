# HTML DBMS

**Experimental monofile encrypted hash-linked DBMS for the browser.** One HTML file contains executable UI code and a JSON object of encrypted records. Every save downloads a new standalone version.

## Demo (v2)

Download/open [`dist/html_dbms.html`](dist/html_dbms.html) in a modern browser with Web Crypto support. You can edit two synthetic tables and append rows to a separate transaction history. Download a new HTML with all changes. There is **no real financial information** in the repository.

## Algorithm

Each event is serialized as `[version,seq,kind,time,prev_key,prev_hash,payload]`. SHA-256 of the serialized event is also the AES-GCM key for that event. The plaintext record includes the prior map key and hash. The successor's map address is deterministic: first 16 bytes of SHA-256 of the domain-separated prior hash, Base64url encoded. Existing keys are never overwritten. A first (genesis) record needs an initial random address. IVs remain random per encryption.

From a known head hash, try decryption of the record map to identify the latest event, then walk backwards using `prev_key`, verify all hashes and derived successor addresses, and replay patches forward. The global JSON map can contain multiple independent chains with no public registry. The main demo chain points at a separate append-only transaction chain.

**Security warning:** The hash-as-key design is experimental message-locked encryption and **does not protect predictable data against offline guessing**. A public head allows anyone to read its chain. A head stored in the same untrusted HTML is not an external proof of provenance. Two separate copies may evolve into conflicting branches; deterministic addresses prevent competing successors only within a shared map. This is not a peer-to-peer consensus mechanism. Embedded HTML JS can itself be altered; verify suspicious copies using trusted code and an independently saved anchor.

## Development

- `node tests/core.test.cjs` — deterministic address, append-only, collision, multiple-chain and JSON Patch tests.
- `python build.py` — package `src/index.html` + `src/core.js` + `src/app.js` into self-contained `dist/html_dbms.html`.
- Browser UI smoke test is experimental and not yet guaranteed in headless sandbox environments.

Requirements: [`docs/SRS.md`](docs/SRS.md) (Wiegers/Beatty-informed structure), canonical RepoGuard requirements under [`requirements/html-dbms`](requirements/html-dbms). Roadmap in issues #1–#4.

## Status

Early research prototype, **not audited** and not suitable for confidential or regulated production data. The full stored-code editor, calculations, charts, Excel import and jsonRVM interpreter are future work, not delivered features.

## Repository governance

The PR workflow uses [RepoGuard](https://github.com/netkeep80/repo-guard) pinned to commit `74db97791e6da8a75287164f0d0b41579108f114` to check explicit links from `HDBMS-*` requirements to implementation, documentation and verification artifacts. Subject tests and reproducible artifact checks are run separately. Workflow installation alone does not configure required branch protection or approve any security guarantees.
