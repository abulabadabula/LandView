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
