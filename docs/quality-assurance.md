# Quality assurance for a data pipeline that failed silently

## Starting point

A local process turns a large document corpus into a searchable collection
of facts: source document → text → tagged individual facts → knowledge base. It ran for
weeks, diligently producing output, and looked healthy.

It wasn't.

## The seven faults

Not a catalogue of conceivable problems, but the list of what this pipeline
demonstrably got wrong — plus why nobody noticed.

| # | Fault | How it showed | Why it went unnoticed |
|---|---|---|---|
| 1 | Resume logic never matched | two documents processed three times, one twice | nobody checked for duplicates |
| 2 | "Done" recorded *before* the work | one document stuck at 11 facts | "done" was a claim, not evidence |
| 3 | Scan aborted after 15 of 217 pages | document yielded almost no text | no coverage check |
| 4 | Orchestrator carried on after an abort | next category started unasked | no clean shutdown |
| 5 | One category was effectively empty | 11 facts, unnoticed for days | no plausibility check |
| 6 | Fact quality varied | mixed-language text, author opinions as facts | nobody ever looked |
| 7 | Plan vs. reality never compared | one document never processed, two categories without a source | no inventory check |

### The costliest one in detail

Fault 1 is instructive. The resume logic tracked processed documents via a header
line in the output file. On reading, the value was **trimmed** (`.strip()`),
but then compared against the **untrimmed** folder name. Many document folders end
in a space — for those the comparison *always* failed.

Consequence: those documents were fully recomputed on **every** run. The
next start would have redone 9 of 13 — hours of compute for duplicate data.
It only came to light because someone wondered why the machine was warm.

## The principle that followed

> **The pipeline checked whether a step had *run* — never whether the result
> was *right*.**

Two rules came out of that:

1. **Nothing counts as finished that isn't verified against the source.** A
   step may not declare its own success.
2. **When in doubt, stop and report — don't carry on.** A visible abort is
   harmless. A completed job with silent data loss costs days.

## The verification tool

Five stages, read-only, no model — therefore reproducible and finished in
seconds. Exit code 0 / 1 / 2, so it also works as a gate inside the pipeline.

| Stage | Checks | Example finding |
|---|---|---|
| 1 | Inventory: manifest ↔ files ↔ folders ↔ outputs | one document never processed; two categories without a source |
| 2 | Scan integrity: source page count ↔ pages processed | one document at 6.9% coverage |
| 3 | Completeness: end markers, duplicates, facts per section | documents present multiple times |
| 4 | Fact quality: format, language, opinions, attributions | **191 leaked source references**, 8,053 duplicates |
| 5 | Coverage: does every app topic have substance? | two substrates with no source at all |

### One detail that makes the difference

The first attempt at stage 2 compared the **file size** of extracted text
against the size of the source file. That produced **two false alarms** and nearly
discarded a perfectly good document — an image-heavy one naturally has
little text per megabyte.

The reliable measure was a different one: the **page count** recorded by the
converter itself, against the source's actual page count. With that: all but
one at exactly 100%, and that one at 6.9%. No false alarms, no missed gaps.

**The lesson:** a heuristic that's *roughly* right is worthless for an
integrity check. It pays to keep looking for the quantity that actually
constitutes proof.

## Hardening the pipeline itself

| Mechanism | Purpose |
|---|---|
| Per-section checkpoint | An interruption costs one section instead of many hours |
| Atomic writes | A half-finished document never reaches the output file |
| Lock file | Two concurrent runs can't collide |
| Clean shutdown | Current section finishes, "done" is *not* recorded |
| Per-document self-check | Anomalies surface immediately, not days later |
| Machine-readable log | Completeness is queryable instead of reconstructed from prose |

All of it was **tested against reality**, not merely compiled: a real abort
mid-document, the lock against both a live *and* a dead process, resumption at
the correct position.

## Three bugs in my own checks

That very testing revealed that three of the new mechanisms were themselves
faulty:

**The abort guard did nothing.** In shell, `if ! command; then status=$?`
returns the value of the *negation* — always 0, never the real exit code. The
abort code never arrived; the pipeline carried on after an abort regardless.
The mechanism *looked* like it worked.

**A completeness check produced five false alarms**, because it stripped
leading special characters too crudely and landed inside an image embed.

**A coverage check reported a gap that didn't exist.** It searched for
"giessen" and "bewaesser" while the data spells them "gießen" and
"bewässer". Reported: 3 facts on irrigation. Actual: 96.

The last one matters most. **A falsely reported gap is just as harmful as a
missed one** — it sends someone hunting for a problem that isn't there. Both
cases are now documented as rationale in the code, so nobody "simplifies" the
check later.

## What the finished checks found

Across 65,398 facts:

| Finding | Count | Share |
|---|---:|---:|
| not translated | 7,444 | 11.4% |
| duplicates | 8,053 | 12.3% |
| **leaked source references** | **191** | 0.3% |
| format errors | 61 | 0.1% |
| opinions instead of facts | 14 | — |

The 191 references are the most serious: phrasing that points back at the
source violates the system's own output rules and would have surfaced in
user-facing answers.

A deterministic cleanup tool removed them along with duplicates and format
errors — **65,398 → 57,079 facts**, with a backup taken first. The English
facts were deliberately *not* deleted: losing content would have been the
convenient but wrong path.
