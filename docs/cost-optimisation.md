# Cost optimisation: from measurement to halving

Every number here is **measured**, not estimated — via real API calls against
the production setup, with 20 fixed test questions.

## Step 1: measure first, judge second

The starting question was "what does a user cost me per month?" Instead of
guessing, I measured a typical diagnosis:

| Item | Tokens |
|---|---:|
| Prompt total | 17,076 |
| *of which cached* | *15,668* |
| **Retrieved passages** | **20,345** |
| Response | 709 |
| **Total** | **38,130** |

That was the surprise: **the model isn't the expensive part — retrieval is.**
Roughly 70% of the cost goes to passages supplied by the RAG system.

Also measured: a photo at maximum size costs **1,089 tokens** — and the app
allowed up to ten of them per request at the time.

## Step 2: look for the dial — and find there isn't one

The obvious first thought: limit the number of retrieved passages. The File
Search interface has a parameter for it. So I measured, three runs each:

| Setting | Retrieval tokens |
|---|---:|
| `top_k: 1` | ~18,700 |
| `top_k: 3` | ~19,400 |
| unset | ~20,100 |
| `top_k: 10` | ~22,300 |

**The dial barely moves anything** — 17% between smallest and largest, with a
floor around 18,700 tokens. A target of 8,000 tokens simply wasn't
achievable. An alternative parameter was rejected outright by the interface.

This was an important intermediate result: **the desired control didn't
exist.** Rather than force it, I reframed the question.

## Step 3: the right question

If the *amount* can't be controlled — can the *whether* be?

A diagnostic conversation rarely consists of nothing but new topics. After the
first, detailed description come short follow-ups about the answer just
given: "how often?", "and in coco?", "thanks, what else?". Those need no new
source passages — the model already has the previous answer in context.

The rule that came out of it:

```
Retrieve when:
  · it's the first message of the conversation
  · new photos are attached
  · the message is substantial (> 140 characters)
  · a symptom or technical topic is named

otherwise: don't retrieve.
When in doubt: retrieve.
```

Deliberately a code rule, **not a second AI call**. A classifier in front
would itself be a model call — partly the very problem it's meant to solve.
In this same project such a "gatekeeper" had already been switched off once,
because it wrongly dismissed genuinely diagnostic messages as small talk.

→ [The code](../sample-code/wissensbedarf.js)

## Step 4: the result

By request type:

| Request type | Saving |
|---|---:|
| First message of a diagnosis | 0% (needs retrieval) |
| **Follow-up in conversation** | **66%** |
| Library search (different model) | 17% |
| Photo portion (limit 10 → 4) | 60% |

By conversation length:

| Conversation | before | after | Saving |
|---|---:|---:|---:|
| 1 question, no follow-up | 0.71 ct | 0.71 ct | 0% |
| 1 + 1 follow-up | 1.42 ct | 0.95 ct | 33% |
| 1 + 3 follow-ups | 2.84 ct | 1.43 ct | **50%** |
| 1 + 8 follow-ups | 6.40 ct | 2.62 ct | 59% |

For a typical subscriber: **€0.55 → €0.29 per month, i.e. 48%.** The cost
ratio against net revenue fell from 11.0% to 5.7%.

**A side effect that wasn't the goal:** response time halved, from 5.5 to 2.6
seconds. What the user notices is worth more than the cents saved.

## What I say honestly alongside it

The saving only materialises **inside a conversation**. Someone who asks one
question and leaves saves nothing. That suits this product — diagnostic
conversations almost never end after one question — but it's a condition, not
a law of nature.

And the figure depends on the app sending the prior conversation along. I
verified that in the generated code rather than assuming it.

## A proposal I rejected

11% of extracted facts had stayed in English. The obvious move: translate
them up front.

Testing showed that would be **unnecessary and harmful**: the language model
was given real English facts as context and a German question — and answered
cleanly in German, with correctly rendered technical terms. The knowledge
base doesn't need to be German at all.

Worse: pre-translation by the small local model demonstrably degraded the
facts. In testing, "calcium" became "Kalium" (potassium) — a different
nutrient, which would have recommended the wrong action to users.

**Turning correct English into incorrect German is the worst of all options.**
The already-built translation step was removed from the pipeline again.
