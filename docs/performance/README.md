# Performance reserve

Work we **deliberately did not do**, each of which would buy frame time or memory if we ever need it. This
is the plan-B list: when a build comes back too slow, read this before inventing anything, because the
cheapest wins are usually already written down here with their price attached.

Most entries have the same shape — **the same result, computed earlier**. We keep choosing the runtime side
of that trade for good reasons (one code path for converted and modloader assets, no format churn, no
re-convert to see a change), and every one of those choices leaves a precomputation on the table. That is
what this rubric collects.

**Maintenance rule** (also in `CLAUDE.md`): when a change picks the runtime path over a precomputed one — or
takes any deliberate cost for correctness, simplicity or moddability — add the alternative here in the same
change, with what it would save, what it would cost, and what would have to be true to pull it.

An entry is not a plan and not a promise. It is a lever with a measured price, so the decision at 30 fps is
a lookup rather than a redesign.

Distinct from the neighbouring rubrics:

- `docs/benchmarks/*` — measured runs, the evidence any of this would be judged against.
- `docs/improvements/*` — nice-to-have enhancements, parked; about features, not about cost.
- `docs/edge-cases/*` — limits we live with today, not levers we could pull.
- `docs/ideas/*` — design directions not scheduled yet.

| Lever                                            | Doc                                          | Est. win                                     | Status                  |
| ------------------------------------------------ | -------------------------------------------- | -------------------------------------------- | ----------------------- |
| Bake vehicle sky-occlusion in opensa-pack        | [vehicle-ao-baking.md](vehicle-ao-baking.md) | 8–78 ms per model at spawn (once per model)  | in reserve — not needed |

## How to use it when the frame budget is blown

1. Find the stage that is actually slow (`docs/benchmarks/readme.md` has the harness and the schema).
2. Scan this list for a lever in that stage — spawn hitches, streaming, GPU pass, memory.
3. Read the entry's **cost** section first. Every lever here was refused for a reason, and the reason does
   not disappear because the frame rate dropped; it just gets weighed against a real number.
4. If you pull one, record the before/after in `docs/benchmarks/` and move the entry to a plan.
