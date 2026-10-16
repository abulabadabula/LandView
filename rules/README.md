# LandView planning rule packs

Planning values are data, not constants embedded in geometry or compliance code.
Each pack is tied to a council, planning instrument/version, zone and dwelling
typology. The pack schema is at rules/schema/rule-pack.schema.json.

## Current status

The file rules/auckland/draft/single-dwelling.yaml is a validation template only.
It intentionally contains no planning values, zone selection, operative version or
planner sign-off. It is not eligible for solving. Do not populate it by copying
illustrative values from product requirements or outdated examples.

Before a pack can be marked CURRENT, its maintainer must verify the operative
instrument and legal status for the target site and capture:

- the plan version and effective date;
- the exact clause or rule reference and source URL for each value;
- the deterministic input mapping (`metric_key`) for each executable rule;
- the planner/reviewer and review date;
- a new semantic pack version when rule content changes.

An unconfigured or superseded pack must fail closed rather than silently produce a
permitted/not-permitted conclusion. Rules that cannot be resolved from the source
documents must remain absent or explicitly unresolved, not be guessed.

## Commands

Run from the repository's backend directory after installing requirements-dev.txt:

~~~sh
python -m landview_core.rule_cli lint ../rules/auckland/draft/single-dwelling.yaml
python -m landview_core.rule_cli diff ../rules/auckland/draft/single-dwelling.yaml ../rules/auckland/draft/single-dwelling.yaml
~~~

lint validates YAML against the JSON Schema and the Python cross-field checks.
diff reports rule additions, removals and field-level changes as JSON.


## Deterministic evaluation API

The backend exposes:

- `GET /api/house-design/rules/packs` — lists validated packs and marks whether each is eligible for solving.
- `POST /api/house-design/rules/evaluate` — evaluates scalar measurements against the selected registered pack, returning a per-rule status matrix, clause/source references, pack version, and SHA-256 hashes for the rule pack and measurement input.

An executable rule uses `metric_key` to name the measurement produced by a deterministic site or geometry engine. Supported operators are `max`, `min`, `equals`, and `boolean`. An `informational` rule never produces a compliance Pass/Fail. Missing measurements return `NOT_EVALUATED`; any such check prevents an overall Pass. Packs that are `DRAFT` or `SUPERSEDED` are not evaluated and return `BLOCKED`.

The API accepts a registered `packId`, not a filesystem path, so callers cannot select arbitrary server files. The current Auckland placeholder is intentionally empty and remains `DRAFT`. Do not infer Auckland planning values from this evaluator until a planner has confirmed a complete rule pack for the relevant zone and overlays.
