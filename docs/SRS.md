# HTML DBMS — Software Requirements Specification (experimental v2)

Status: draft baseline 2026-11-22. Based on the *requirements engineering approach* of Karl Wiegers and Joy Beatty, *Software Requirements*, 3rd ed., particularly chapters 5, 8–11, 13–14, 17, 21, 27–29. This document contains original project requirements, not copied book text.

## 1. Purpose, stakeholders and scope

**Business goal BG-01.** Permit a non-specialist to maintain a portable structured record system without Excel, installation or a server, and to distribute independently inspectable snapshots.

**Actors:** operator (edits and saves), reader (views), verifier (checks against an independently trusted hash), developer (extends schema and behavior), malicious editor (threat actor).

**In scope (v2 prototype):** portable HTML container, RFC 6901 pointers and RFC 6902 patch replay, multiple tables, encrypted hash-linked event chains, deterministic successor addressing, a separate append-only transaction chain, verifiable exports and a minimal UI.

**Not in scope:** strong confidentiality of predictable plaintext, authenticated authorship, global consensus or fork exclusion across separate copies, arbitrary JS execution from database, full legacy workbook import, formulas and chart designer, full jsonRVM.

## 2. Assumptions and business rules

- BR-01: An already recorded financial transaction is never mutated or deleted; corrections are additional events.
- BR-02: A successor event can only be written to a currently unoccupied deterministic address in the same physical map.
- BR-03: A receiver needs an independently obtained trusted head hash for provenance checks. A self-declared head alone establishes only internal consistency.
- BR-04: Distinct logical chains may coexist without a public database catalogue. Their count, sizes and changes are not necessarily hidden.
- A-01: Secure-context Web Crypto API, TextEncoder, structuredClone and download support are available in a tested browser; compatibility is a tested target, not universal guarantee.

## 3. Functional requirements

Each MUST has an observable acceptance condition. IDs are stable for issue/test traceability.

| ID | Priority | Requirement and observable condition |
|---|---|---|
| FR-01 | Must | System SHALL open a single HTML document without an application server, external scripts, external CSS or network calls. Validate by opening offline and using UI. |
| FR-02 | Must | System SHALL save a standalone copy containing the entire current encrypted map. Reopening SHALL reconstruct the same tables and chain heads. |
| FR-03 | Must | The download name SHALL use a sanitized editable title and local timestamp `title_yyyy.mm.dd_hh.mm.ss.html`; no claim of strict filename uniqueness within one second. |
| FR-04 | Must | Every successor record SHALL use map key `B64URL(SHA256(UTF8("html-dbms/map-id/v2\\0") || SHA256(plaintext_previous_record))[0..16])`. Genesis keys SHALL be random. No map key SHALL be overwritten. |
| FR-05 | Must | Each record SHALL be AES-256-GCM encrypted under its own SHA-256 plaintext digest, with random 96-bit IV; reader SHALL authenticate and verify digest. This is an **experimental integrity-oriented format, not a promise of secrecy**. |
| FR-06 | Must | Given a chain head hash, the reader SHALL find exactly one last record by attempting authenticated decryption of map values, then follow `prev_key` and verify `prev_hash`, sequence, and expected successor address back to genesis. Unrelated records SHALL be ignored. |
| FR-07 | Must | Reader SHALL support at least two logical tables with stable row IDs and editable cells; table data SHALL be represented as JSON objects, not positional row arrays. |
| FR-08 | Must | Reader SHALL apply RFC 6902 ordered operations using RFC 6901 paths; an invalid operation SHALL leave its input state unchanged. Prototype pollution paths SHALL fail. |
| FR-09 | Must | A separate transaction chain SHALL allow append of a new row only; it SHALL reject updates, deletes, and overwrites to previously recorded rows. |
| FR-10 | Must | Main state SHALL reference a nested transaction head. When extending the transaction chain, a new main event SHALL update that pointer; old events remain unchanged. |
| FR-11 | Must | Operator SHALL be able to check an independently supplied historical hash against the recovered main chain. Verifier SHALL read an external HTML as data without executing its scripts. |
| FR-12 | Must | UI SHALL allow adding rows, columns to ordinary tables, and renaming a document through persisted events. |
| FR-13 | Should | Future releases SHALL describe procedures, derived views, validations, charts, dropdowns and events as editable model objects; change history SHALL use the same journal format. Not implemented in v2. |
| FR-14 | Could | Future releases MAY load validated Relations Model JSON programs via a restricted JS jsonRVM interpreter. Not implemented. |

## 4. External interfaces and data model

**Physical storage**: `{format, publicHead, records}`; each `records` value is `{iv, ct}` (Base64url). Keys are Base64url of 16-byte IDs. Other chains may exist without being listed in `publicHead`.

**Event**: ordered JSON array `[version, seq, kind, utcTime, prev_key, prev_hash, payload]`. Genesis events provide policy and complete initial state; subsequent events carry `{patch:[...]}`.

**Logical main state**: `{title, tabs, tables}`. Table rows are objects keyed by stable row IDs. A transaction table has `type:"chain"` and a `headHash` reference to a separate chain.

**JSON Pointer**: RFC 6901 escaping is required for `~` and `/`; unsafe prototype keys are rejected. **JSON Patch**: RFC 6902 add/remove/replace/move/copy/test. These are logical edits applied oldest to newest; snapshots are reconstructible by replay.

## 5. Quality attributes and security

| ID | Requirement | Verification |
|---|---|---|
| NFR-01 | Portability: no install or network dependency for a fully saved HTML. | Offline browser smoke test and inspection for external resource URLs. |
| NFR-02 | Integrity: corrupted ciphertext, hash mismatch, invalid ancestry or missing predecessor MUST fail closed. | Negative automated crypto tests. |
| NFR-03 | Safe parsing: JSON Pointer paths MUST reject `__proto__`, `prototype`, `constructor` at each segment. | Unit tests. |
| NFR-04 | Bounded processing: reject excessive chain depth and record count; patch batches limited to 1000 operations. | Boundary tests. |
| NFR-05 | Privacy: only synthetic examples in public source, tests, issues and documentation. Never upload confidential datasets or templates derived from them. | Repository review. |
| NFR-06 | Truthful security: documentation and UI MUST identify the hash-as-key construct as experimental and vulnerable to guessing low-entropy plaintext; no claims of global immutability or authenticated authorship. | Documentation/UI review. |
| NFR-07 | Traceability: source, tests and CI SHALL relate to rooted requirements; RepoGuard configured at immutable upstream SHA, exact BASE/HEAD. | GitHub workflow + RepoGuard output. |
| NFR-08 | Browser support SHALL be verified against a defined browser/version matrix before general release. | Deferred browser CI. |

## 6. Key use cases and acceptance scenarios

**UC-01: edit/save/reopen.** Given a new HTML, operator adds a row to table A, edits it and adds a row to B, saves, opens saved file. Both tables and hashes are preserved.

**UC-02: append transaction.** Given a transaction head H, append transaction T. New transaction record is stored under derived map address from H and main head points at new child head; attempting to edit T is rejected.

**UC-03: competing successor.** Given same predecessor H and map M, two different successors target same map key; only first is written, the second yields explicit conflict, prior ciphertext unchanged. Separate copied maps may still fork.

**UC-04: verifier.** Given a recipient HTML and a previously independently trusted H, verify whole chain from the recipient head and detect H as ancestor; reject tampered records or absent H. Verify with trusted code, never recipient HTML scripts.

**UC-05: mixed independent chains.** A map contains at least two interleaved logical chains; providing H_A reveals and verifies A without requiring B's head; traversal does not infer a mandatory total count of logical databases.

## 7. Traceability and open decisions

- BG-01 -> FR-01..FR-03, FR-07, FR-12; GitHub issues #2, #3.
- BR-01 -> FR-09..FR-10; issue #2.
- BR-02 -> FR-04, FR-06; issue #1.
- BR-03 -> FR-05, FR-11, NFR-02/NFR-06; issues #1, #4.
- BR-04 -> FR-06, UC-05; issues #1, #4.
- **Pending:** independent cryptographic audit; replay and simultaneous-head semantics across nested chains; browser CI; handling very large files; multi-head permission model; full formulas, charts and metadata editor. These are NOT accepted as delivered.

## 8. Verification and change control

Every changeset should cite issue and requirement IDs. Tests prove only enumerated properties; CI success does not imply acceptance or real-world accounting readiness. Requirements changes require explicit review, impact assessment and updated tests. Repository guards and branch protection are separate mechanisms; installing a workflow alone does not enable a required GitHub check.
