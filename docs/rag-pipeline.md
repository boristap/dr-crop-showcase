# Building the RAG pipeline

Most retrieval-augmented systems are built the same way: drop documents into a
vector store, retrieve the nearest chunks, hand them to the model. That works,
and it was not what I did.

This page explains the design decisions, what each one cost, and which of my
assumptions the measurements destroyed.

---

## The core decision: index facts, not text

The conventional approach retrieves *passages* — a few hundred words of
whatever sat closest in embedding space. I retrieve **atomic, tagged facts**
instead.

A local pipeline distills every source document into single-sentence
statements, each carrying a domain tag:

```
[Living Soil] In a living substrate, bacteria and fungi take over nutrient supply.
[Coco]        Coco coir should be buffered with calcium and magnesium before first use.
[General]     Capillary water is a primary water source for plant roots.
```

**Why this is worth the effort:**

| | Passages | Tagged facts |
|---|---|---|
| Noise per retrieval | high — a passage carries whatever surrounds the relevant sentence | low — every retrieved line is a claim |
| Filterable by domain | no | yes, via the tag |
| Traceable | you see the text, not the claim | one line = one checkable statement |
| Cost per retrieval | pays for the surrounding text too | pays only for claims |

**What it costs:** a distillation step that takes hours of local compute, and
a whole class of quality problems that raw text simply doesn't have — a
passage cannot be mistranslated or invented, a generated fact can. Which is
why the [verification stack](quality-assurance.md) exists at all.

That trade is the actual engineering decision here: **I moved work from
retrieval time to build time**, and paid for it with a pipeline that has to be
policed.

---

## The pipeline

```
Source documents
      │  page coverage verified against the source (not file size — see below)
      ▼
Text extraction (Marker, local)
      │  sectioned at ~6,000 characters, split on headings
      ▼
Fact extraction + verification (local 7B model, two passes)
      │  per-section checkpoint · atomic writes · per-document self-check
      ▼
Deterministic cleanup
      │  duplicates, format errors, opinions, leaked source references
      ▼
Gemini File Search  ←── queried by the app, but only when needed
```

Everything up to the store runs **locally**. The source material never leaves
the machine — a constraint, not an optimisation, and it costs roughly 50 hours
of compute for the current corpus.

---

## Four things the measurements changed

### 1. Retrieval was the cost, not the model

Measured on a real diagnosis: 38,130 tokens, of which **20,345 — about 70% of
the cost — were retrieved passages.** The model itself was the cheap part.

Almost every cost discussion about LLM apps starts at the model. For this
system that would have optimised the wrong 11%.

### 2. The retrieval dial barely turns

The obvious lever was to retrieve fewer passages. The interface has a
parameter for it. Measured, three runs each:

| Setting | Retrieval tokens |
|---|---:|
| `top_k: 1` | ~18,700 |
| `top_k: 3` | ~19,400 |
| unset | ~20,100 |
| `top_k: 10` | ~22,300 |

**17% between the smallest and largest setting, with a floor around 18,700.**
The dial exists but does almost nothing. A target of 8,000 tokens was simply
not reachable, and an alternative parameter was rejected outright by the API.

Knowing a lever is fake is worth as much as finding a real one — it stops you
tuning a knob that does nothing.

### 3. So the lever became *whether*, not *how much*

If volume can't be controlled, control frequency. A diagnostic conversation is
rarely all-new topics: after the first description come follow-ups that need
no new source material, because the previous answer is already in context.

The decision rule runs in code — deliberately **not** a second model call,
which would reintroduce the cost it's meant to remove:

```
retrieve when: first message · new photos · substantial message · a symptom named
otherwise:     don't
in doubt:      retrieve
```

**Result: 48% lower cost per user, and response time halved** from 5.5 to 2.6
seconds. → [Full analysis](cost-optimisation.md) ·
→ [The code](../sample-code/wissensbedarf.js)

### 4. The knowledge base doesn't need to speak the user's language

11% of extracted facts had stayed in the source language. The obvious fix was
to translate them up front.

Tested instead of assumed: the model was given untranslated facts as context
and a German question — and answered in fluent German, with correct technical
terminology. **Cross-lingual retrieval and generation simply worked.**

Worse, pre-translation by the small local model *degraded* the data. In
testing, "calcium" came back as "Kalium" (potassium) — a different nutrient,
which would have recommended the wrong treatment to a user.

The translation step was built, measured, and then deleted. **Turning correct
source text into incorrect target text is the worst available option.**

---

## What I would tell someone building this

**Measure retrieval before optimising anything.** The intuition that the model
dominates cost is widespread and was wrong here by a factor of six.

**Check that your levers are real.** Two of the three obvious optimisations in
this system — the retrieval-size parameter and larger section sizes — turned
out to change nothing or make things worse, and both only under measurement.

**Distilling into facts is a real option, not a curiosity.** It buys precision
and filterability at the price of a build pipeline that must be verified. If
you take that trade, budget for the verification — it is not optional, and
[here is what happens when it's missing](quality-assurance.md).

**Language is not the boundary you think it is.** Retrieval and generation
crossed it without help. Normalising the corpus would have cost compute and
accuracy for nothing.
