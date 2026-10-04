# Kanmi Guard CLI

The CLI is the first non-VS Code surface for the Kanmi Levers Guard rules engine. It is intended for local build checks and CI.

## Run against production artifacts

```bash
npm run guard
```

By default, Guard scans the production artifact paths from `kanmi.policy.json`, or these defaults when no paths are configured:

- `dist`
- `build`
- `out`
- `public`
- `.next`
- `artifacts`

You can target one or more paths explicitly:

```bash
node out/cli.js check --path .next --path public
```

## CI behavior

The default exit policy blocks only on error-level findings:

```bash
node out/cli.js check
```

To make warnings blocking as well:

```bash
node out/cli.js check --fail-on warning
```

For machine-readable output:

```bash
node out/cli.js check --json
```

Exit codes:

- `0`: guard passed at the configured failure threshold
- `1`: findings exceeded the configured failure threshold
- `2`: the guard could not run, for example because policy JSON was invalid

## Policy

The CLI reads the same `kanmi.policy.json` format used by the extension. WRS production-artifact paths, the near-limit byte threshold, and `disabledRules` are shared immediately. Additional SEO and performance checks will move behind this shared core incrementally so editor, CLI, and CI surfaces remain behaviorally consistent.
