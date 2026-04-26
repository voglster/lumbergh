# Release Workflow

When the user says "release" (or "release minor", "release major"):

Run `./release.sh <level> -y` where level is `patch` (default), `minor`, or `major`.

The script handles everything: preflight checks, lint, version bump, tag push, and workflow monitoring. Just run it and relay the output.

If the user doesn't specify a level, pick one based on commits since last tag:
- **patch**: bug fixes, small tweaks, UI polish
- **minor**: new features, new endpoints, meaningful UX additions
- **major**: breaking changes, large rewrites
