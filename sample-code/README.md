# Sample code

Real, production code from the project — selected, not written for display.

**A note on language:** the inline comments are in German, the project's
working language. They're left untouched on purpose: each one explains *why*
something is the way it is and names the concrete incident the rule came from.
That reasoning is the point of showing it at all.

## Backend (Node, Firebase Cloud Functions)

| File | What it shows |
|---|---|
| [`gemini-client.js`](gemini-client.js) | **The API integration.** How the model is called: request assembly, retry with a fallback model, a hard fetch timeout, and the retrieval tool. Every timeout value carries the incident that set it. |
| [`quota.js`](quota.js) | **Abuse protection.** Per-minute rate limit, daily and monthly caps, free-tier accounting — all in atomic transactions. Includes a documented, deliberate deviation from the file's own design rule, with the reasoning. |
| [`wissensbedarf.js`](wissensbedarf.js) | **The cost lever.** Decides, without a second AI call, whether retrieval is needed. Halves the cost of a conversation. |
| [`image-validation.js`](image-validation.js) | **Server-side input validation.** Resolution and count limits enforced where they actually hold, not just in the UI. |

## Front end (FlutterFlow)

| File | What it shows |
|---|---|
| [`flutterflow-lexikon-suche.dart`](flutterflow-lexikon-suche.dart) | **The app is built by script, not by clicking.** An excerpt from the ~14,800-line DSL that defines the app: every page, widget and action chain is declarative and therefore versionable. This excerpt fixes a reported "search doesn't work" — where the cause turned out to be a decorative icon with no tap handler, plus a state value lagging two seconds behind the input field. |

## What isn't here

The system prompt, the knowledge base and its source material, credentials,
and anything that would expose either.
