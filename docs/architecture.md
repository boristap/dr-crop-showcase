# Architecture

## Overview

```
   Phone (iOS / Android)
   ┌──────────────────────────────────────┐
   │  FlutterFlow app                     │
   │  Chat · Photos · Dictation · Library │
   └───────────────┬──────────────────────┘
                   │ HTTPS, Firebase ID token
                   ▼
   ┌──────────────────────────────────────┐
   │  Cloud Functions (Node, Frankfurt)   │
   │                                      │
   │  1. Verify token                     │
   │  2. Rate limit    ← cheapest check   │
   │  3. Quota (daily / monthly / free)   │
   │  4. Validate images (max. 4)         │
   │  5. Decide on retrieval        ←─────┼── the cost lever
   │  6. Model call                       │
   │  7. Write history + plant record     │
   └───────┬──────────────────┬───────────┘
           ▼                  ▼
   ┌───────────────┐   ┌──────────────────┐
   │ Gemini        │   │ Firestore        │
   │ + File Search │   │ Users, history,  │
   │ (knowledge)   │   │ plant records    │
   └───────────────┘   └──────────────────┘
```

The order of steps 1–5 isn't accidental — it's the result of a correction.
Image validation originally ran *before* the rate limit. It decodes up to four
base64 images and reads their resolution: real compute that a flooding client
would have triggered on every request, even though the request gets rejected
anyway. The cheapest check belongs first.

## The endpoints

| Function | Purpose | Notable |
|---|---|---|
| `diagnose` | Main function: chat and diagnosis | 512 MiB, one instance kept warm against cold starts |
| `searchKnowledge` | Reference library | separate, cheaper model |
| `getConversations` / `getConversation` | History | list stays lean, full text only on open |
| `getCases` / `getCase` / … | Plant records | photo links freshly signed on every read (1 h) |
| `createUserDocument` | Creation on first sign-in | with self-healing, see below |
| `cleanupExpiredCases` | Housekeeping, daily 03:00 | |

## Two decisions that proved their worth

**One permanently warm instance.** Cold start plus model latency added up to
roughly 20 seconds — the first request after any idle period ran into the
client timeout and looked to the user like a total outage. The warm instance
costs about €1.60 a month. Worth it.

**Self-healing on the user document.** The creation trigger runs
asynchronously *after* sign-in. On a fresh install the very first request can
arrive before the document exists — the app then simply stopped answering.
Today the quota check creates the document itself if needed, idempotently.

Both happened in production and looked identical to users ("the app is
broken"), while having entirely different causes. Telling such cases apart
cleanly is where the real work is.

## The knowledge pipeline

Separate from the app, a local process runs on a MacBook:

```
Documents  →  Text extraction (Marker)  →  Fact extraction (local 7B model)
                     │                              │
              page coverage                  per-section checkpoint,
              verified at source          atomic writes, self-check
                                                    │
                                            Cleanup (duplicates,
                                            attributions, format)
                                                    │
                                            Gemini File Search
```

Deliberately local: the source material stays on the machine.
The price is time — roughly 50 hours of compute for the remaining backlog.

Why it stays that way even though an API route would finish in 15 minutes for
under 4 US dollars: I costed that out and presented it — the decision for the
local route was made deliberately.

## Model choice

| Use | Model | Rationale |
|---|---|---|
| Diagnosis | `gemini-3.5-flash-lite` | best quality/price trade-off, confirmed by an A/B comparison across 20 cases |
| Reference library | `gemini-3.1-flash-lite`, thinking throttled | simpler task, 17% cheaper per search |
| Fact extraction | Qwen2.5-7B, local | source material stays local |

Model names are configuration values, not hard-wired code — with separate
keys for diagnosis and library, so a change to one can't accidentally drag
the other along.
