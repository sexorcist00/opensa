---
name: grill-me
description: Interrogate the user before any implementation — surface every decision, ambiguity and hidden cost as a question through the Ask Menu, and refuse to write code until they are answered. Use before starting ANY implementation, plan, refactor, new file, schema, format, protocol or measurement in this repository. This project requires it; nothing is built on an assumption.
---

# GRILL ME — nothing is built on an assumption

**This project's standing rule (the user's call, 2026-09-06): before ANY implementation, the user is
questioned in detail, and every question goes through the Ask Menu — the `AskUserQuestion` tool — and only
through it.** Not prose in a reply, not a rhetorical "I'll assume X", not a plan that quietly picks. A
question buried in a paragraph is a question the user can skip past without noticing they decided something.

## Why this repository, specifically

Read the session record and the pattern is unmistakable: **the expensive mistakes here were never bad code.
They were good code built on an unasked question.**

- A whole engine change shipped **inert** — every test passing — because nobody asked what configuration the
  callers actually produce.
- An A/B ran for a day with **both halves identical**, because nobody asked whether the arm still differed
  from the default after the default moved.
- An agent was sent to hunt **13 ms that do not exist**, because nobody asked whether the frame time on that
  device measures work at all.
- A branch carried real code for four days while `main` solved the same problem better, because nobody asked
  which side was newer.

Every one of those cost a session. Every one was one question away.

## The rule

1. **Ask BEFORE, not during.** The moment a task implies a decision, stop and ask. Do not start, discover the
   question halfway, and ask then — by that point the answer is constrained by what is already written.
2. **`AskUserQuestion`, always.** Multiple questions per call where they are independent; `multiSelect`
   where the choices are not exclusive. Put a recommendation first and label it, so the user can agree fast
   without you having decided for them.
3. **Ask about what CHANGES the work.** Not preferences with an obvious default — the branch points where
   two readings lead to different code, different data, or different numbers.
4. **Name the cost in the question.** "Which of these" is worth little; "which of these, and here is what
   each one costs" is the question that gets a real answer.
5. **A silent assumption is a defect.** If something genuinely cannot be asked, state it as an explicit
   assumption in the reply AND in the code comment, so the next reader can find and challenge it.

## What to grill for

Run down this list before writing anything. Anything unanswered is a question, not a guess:

- **Scope** — what is explicitly NOT in this? What is the smallest version that is still useful?
- **The authority** — who or what decides this value at runtime: the user, the server, the data, a constant?
  (A constant is the answer that most often turns out to be wrong here.)
- **Derived or chosen** — is every number derived from something, or picked? A picked number owes
  `docs/hacks/` a file. Say which it is.
- **What it costs elsewhere** — which shipped feature does this trade against? This repo has traded
  render-on-demand, battery, and a benchmark series' reproducibility without noticing at the time.
- **How it is verified** — on the desk, or only on the device? A change whose only proof is a test that
  exercises the mechanism rather than the workload is a change that can ship inert.
- **What the operator sees** — a picture change needs a field verdict, at the hour where it is visible.
- **Both surfaces** — phone and desk in the same change, per the cross-platform restriction.
- **What it makes unrepeatable** — does it break any filed benchmark's conditions?

## What this does NOT mean

It is not a delay tactic and not a way to push decisions back. Do the research FIRST — read the code, the
plan chain, the restrictions — so the questions are informed and few. **A question you could have answered
by reading is a question that wastes the user's time**, and asking it is as much a failure as not asking the
one you could not.

Answer everything you can from the repository. Ask about what only the user knows: intent, priority, the
product, the trade they want, and what "good" looks like to them.
