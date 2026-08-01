# InMobi track — What to submit at code freeze

Your submission is scored on the event's standard 6-criteria rubric (ClickHouse &
OSS Stack 25% · Problem Fit 20% · Technical Implementation 20% · Innovation 20% ·
Scalability & Impact 10% · Presentation 5%). The items below are the **evidence the
judges need** to score those criteria for this track. Missing evidence can't be
scored.

Track problem statement:
[PROBLEM_STATEMENT.md](https://github.com/sidagarwal04/click-a-thon-2026/blob/main/InMobi/PROBLEM_STATEMENT.md)
— *"From alert to answer: the automated root-cause analyst."*

All common requirements from the [root README](README.md#how-to-submit) also apply:
source code, README with hosted demo link, architecture, recorded demo video
(2–3 min), and pitch deck PDF.

## 1. Code + how to run it

Your full investigation pipeline — **detect** the metric deviation, **drill down**
to the responsible segment(s), and **produce the plain-language diagnosis** — with a
`RUN.md`: env vars, your ClickHouse Cloud connection, and one command to run the
pipeline end to end against a loaded dataset.

## 2. Architecture (1–2 pager explanation and/or a diagram)

- How detection, drill-down, and diagnosis fit together, and **where the analysis
actually runs** — the drill-down must live in ClickHouse queries, not in the LLM
(judges will check that ClickHouse is doing the real work)
- Your anomaly-detection and attribution approach (baselines, contribution analysis,
ML — anything goes; explainability and trustworthiness matter more than sophistication)
- Which of ClickStack / Langfuse / LibreChat you meaningfully integrated and how
(at least one is required; superficial inclusion won't count)
- LLM provider(s) used and why



## 3. Artifacts folder (the graded outputs)

- **Diagnoses for the anomalies your system found in the main dataset**: the
plain-language explanation, the specific segments named, and every cited number
reproducible from ClickHouse queries (include the queries)
- **What was checked and ruled out** for each investigation (e.g. seasonality,
request volume, CTR) — the bonus criterion from the problem statement
- Detection and localization are judged against the judges' private answer key:
found, missed, or hallucinated — avoid crying wolf on noise



## 4. The unseen incident bundle (mandatory — no trace, no credit)

As described in the problem statement, a fresh slice of the same universe with new
planted anomalies will be released to all teams simultaneously in the final hours
of the hackathon — the release time is announced at kickoff; the incidents are the
surprise. Dataset details and loading notes ship with the release. Your submission
**must** include what your system produced for it:

- **The diagnosis** — plain-language, naming the responsible segment(s), with every
number computed from the data
- **The numbers behind it** — reproducible from ClickHouse queries
- **The trace** that proves your system generated it — a hand-written diagnosis
without a matching trace scores nothing on this criterion

Point your system at the release and let it run. **Build for the unseen incident,
not the anomalies you found during the build.**



## 5. Trace links

Shared or exported traces for each investigation run, so a judge can follow what
was checked, in what order, and why. **The unseen incident's trace is mandatory**
for that output.

## Suggested demo

Replay an incident end to end: a metric drops → the system runs → the drill-down
lights up → a plain-English diagnosis (*"revenue fell because fill rate dropped for
Device X in Region Y; seasonality checked and ruled out"*) → optionally, a follow-up
question in chat.

## Notes

- **Trustworthiness beats sophistication.** Every number in the diagnosis must be
reproducible from the data — a single fabricated figure costs more than a missed
anomaly. Consider letting deterministic code do the analysis and using the LLM
only to narrate.
- Load the dataset into your team's own ClickHouse Cloud service (provisioned with
your event credits); ClickHouse must be the primary datastore and analytical engine.
- **Out of scope:** authentication, production deployment, alerting integrations
(PagerDuty and friends), and polished frontends. Judges reward the investigation
loop, not the scaffolding.
- You have creative liberty with the technical architecture, UI/UX of the product
(can be lean also), final product use case and extra features built.

