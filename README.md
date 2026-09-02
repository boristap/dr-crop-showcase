# Dr. Crop — a diagnostic assistant for plant cultivation

<img src="screenshots/00-hero.png" width="230" align="right" alt="Dr. Crop — The botanical AI">

A mobile app that turns a photo and a few sentences into a solid plant
diagnosis — grounded in a curated domain knowledge base.
iOS and Android, German-language, subscription model.

**I'm Boris Stapelfeld.** I conceived this product, made every technical and
commercial decision, and took it to testing readiness — **built with Claude
Code as a tool, not hand-written.** That's stated openly because it's the
truth, and because the commits would show it anyway. What I bring isn't
typing code: it's the ability to think a product through, ask the right
questions, refuse to take claims at face value, and keep measuring until the
numbers hold up.

This repository shows what that looks like, in concrete examples.

---

## What the app does

| | |
|---|---|
| **Diagnosis** | Upload a photo, describe the problem (typing or dictation) — diseases, deficiencies, pests |
| **Reference library** | Structured articles on any cultivation topic, from the same knowledge base |
| **History & plant records** | Every diagnosis creates a record; a later photo shows the comparison |
| **Memory (Pro)** | The assistant remembers strain, substrate and earlier problems |

<p>
<img src="screenshots/01-startseite.jpg" width="245" alt="Home screen: optional details about the plant">
<img src="screenshots/02-lexikon-suche.jpg" width="245" alt="Reference library with categories and tip of the week">
<img src="screenshots/03-lexikon-artikel.jpg" width="245" alt="Structured reference article">
</p>

<sub>Home · Reference library · Article — every field on the home screen is
optional; you can go straight to the chat. Interface language is German,
the app's target market.</sub>

**Stack:** FlutterFlow front end, Firebase Cloud Functions (Node, Frankfurt
region), Google Gemini as the language model, Gemini File Search as the
knowledge base, Firestore for user data and history.

→ [Architecture in detail](docs/architecture.md)

---

## Three things I'm proud of

### 1. I halved the running costs — measured, not estimated

"What does a user cost me?" isn't a question you can guess at. So I measured
it: real API calls, real token counts.

A typical diagnosis consumes **38,130 tokens**. The breakdown was the
surprise:

| Item | Tokens | Share of cost |
|---|---:|---:|
| Retrieved passages from the knowledge base | 20,345 | **~70%** |
| System prompt (largely cached) | 17,076 | ~11% |
| Response | 709 | ~20% |

The model wasn't the expensive part — *retrieval* was. And a conversation
rarely consists of nothing but new topics: after the initial description come
follow-ups ("how often?", "and in coco?") that need no new source material.
The model already has its previous answer in context.

So: the knowledge base is only queried when it's actually needed — on the
first message, when new photos arrive, when a symptom is named.

**Result: 48% lower cost per user.** A follow-up costs 66% less, a
four-message conversation half as much. Response time dropped from 5.5 to
2.6 seconds as a side effect.

→ [The full cost analysis](docs/cost-optimisation.md) ·
→ [The code](sample-code/wissensbedarf.js)

### 2. I found a pipeline that was quietly producing bad data

A local processing chain turns a large document corpus into a searchable
collection of facts. It had been running for weeks, apparently fine.

Checking it properly surfaced seven faults side by side:

- **Documents were processed repeatedly.** The resume logic compared a trimmed
  name against an untrimmed one — for folder names ending in a space, the
  comparison *always* failed. Two documents sat in the output file three times
  over. The next run would have redone 9 of 13.
- **An aborted run counted as finished.** The "done" marker was written
  *before* processing. One document stayed permanently at 11 facts out of
  several thousand.
- **One scan had captured 15 of 217 pages** — and nobody had ever checked
  whether the page count matched.

The common thread: **the pipeline checked whether a step had *run* — never
whether the result was *right*.**

That became a five-stage verification tool that checks against the source
rather than against itself: PDF page count against pages actually processed,
completeness against freshly recomputed sections, fact quality against fixed
rules.

It immediately surfaced more: **191 facts that pointed back at their source**
(phrasing that would have leaked into user-facing answers), 8,053 duplicates,
11% of entries never translated.

→ [How the quality assurance works](docs/quality-assurance.md)

### 3. I verify the solutions too — especially my own

While building the safety mechanisms I found three bugs in *my own* checks,
each one only because I measured instead of assuming:

- An abort guard that **did nothing** — in shell, `if ! command; then
  status=$?` returns the value of the *negation*, never the real exit code.
  The mechanism *looked* like it worked.
- A completeness check that produced **five false alarms**, because it
  stripped leading special characters too crudely and landed inside an image
  embed.
- A coverage check that **reported a gap that didn't exist** — it searched
  for "giessen" while the data spells it "gießen". Reported: 3 facts.
  Actual: 96.

The last one matters most to me: **a falsely reported gap is just as harmful
as a missed one.** It sends someone hunting for a problem that isn't there.
Both cases are now documented as rationale in the code, so nobody
"simplifies" the check later.

---

## Product decisions with numbers behind them

**Pricing.** Asked whether €4.99 would do, I didn't answer by feel — I ran the
numbers: it covers costs comfortably (8% cost ratio), but €4.99 needs **40%
more paying users** for the same revenue, and it collapses the existing price
ladder, because the 4-month bundle would then cost *more* than paying
monthly. Conclusion: keep the list price, use an introductory discount
instead.

**Abuse protection.** Added after the cost analysis: per-minute rate limit,
daily and monthly caps, server-side photo limit. In the process it turned out
that one endpoint had **no limits at all** — any signed-in user could trigger
unlimited searches.

**A weakness named openly.** The app uses anonymous sign-in, which means the
free quota can be reset by reinstalling. That's not negligence but a
deliberate trade-off between friction and protection — and it belongs on the
table, not swept under it.

---

## What deliberately isn't here

- **The system prompt** (77,000 characters) — the product's core know-how
- **The knowledge base** — the source corpus and everything derived from it
- **Credentials of any kind**

The sample code here is real, production code from the project, merely
selected. The full repositories are private; happy to walk through them in
conversation.

---

## Contact

<img src="screenshots/boris.jpg" width="110" align="left" alt="Boris Stapelfeld" hspace="16">

I'm looking for work at the intersection of **product, AI automation and
engineering** — where someone needs to think a project through, build it with
AI tools, and check the results critically.

If you want to know why a particular decision in this project went one way
and not another: ask me. I can justify every single one.

**[LinkedIn: Philipp Boris Magnus Stapelfeld](https://www.linkedin.com/in/philipp-boris-magnus-stapelfeld-262167131)**
— you'll also find what I can be hired for there.

**GitHub:** [boristap](https://github.com/boristap)
