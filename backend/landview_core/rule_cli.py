"""Command-line linting and comparison for versioned LandView rule packs."""
import argparse
import json
import sys
from pathlib import Path

from landview_core.rules import RulePackError, diff_rule_packs, load_rule_pack


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="landview-rules")
    subparsers = parser.add_subparsers(dest="command", required=True)

    lint_parser = subparsers.add_parser("lint", help="validate one or more YAML rule packs")
    lint_parser.add_argument("paths", nargs="+", type=Path)
    lint_parser.add_argument("--schema", type=Path, default=None, help="optional JSON Schema path")

    diff_parser = subparsers.add_parser("diff", help="compare two validated rule packs")
    diff_parser.add_argument("old", type=Path)
    diff_parser.add_argument("new", type=Path)
    diff_parser.add_argument("--schema", type=Path, default=None, help="optional JSON Schema path")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    if args.command == "lint":
        failed = False
        for path in args.paths:
            try:
                pack = load_rule_pack(path, args.schema)
            except RulePackError as exc:
                print(f"FAIL {path}: {exc}", file=sys.stderr)
                failed = True
                continue
            note = " (not eligible for solving)" if pack.legal_status.value != "CURRENT" else ""
            print(f"OK   {path}: {pack.pack_id} v{pack.pack_version} [{pack.legal_status.value}]{note}")
        return 1 if failed else 0

    try:
        old = load_rule_pack(args.old, args.schema)
        new = load_rule_pack(args.new, args.schema)
    except RulePackError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(diff_rule_packs(old, new), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
