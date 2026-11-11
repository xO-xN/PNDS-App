# Temporary Parameter Preview

## Optional temporary parameter preview (protocol 1)

The root `pnds.preview.json` declares `schemaVersion: 1` and `parameters`. Each entry includes an existing relative text `path`, unique `id`, exact full-line `prefix` and `suffix` around a JSON primitive, `kind` (`number`, `boolean`, `text`, `color`, `option`), applicable `limits` (`min`, `max`, `step`, `options`, `maxLength`), and `preview` (`live`, `refresh`, `restart`, `unsupported`). Live binding requires a unique location, compatible declaration and matching versions.

Blank includes the adapter and an empty declaration. Other projects can wire `PNDS.app/Contents/Resources/preview/adapter.mjs`. `installPreviewAdapter({hostOrigin, sources, contractDigest, parameters})` uses fixed `sha256:<hex>` digests of source and declaration bytes actually loaded, plus project get/set callbacks. Configure the Host origin in the project. Incoming messages cannot supply it.

Messages carry `pnds.preview`, version 1, a fresh session and increasing sequence. Both sides verify origin and window. The Host sends `hello` (parameter IDs), `set` (primitive values) or `restore`. The page returns `ready` (digests, supported items and baseline), `applied` or `restored` (actual readback), or `error`. Setters run in order, skip stale updates, and restore only touched parameters.

Live preview requires the same ready run, saved version and loaded digest. Source changes revoke prior authorization. The App displays failures, timeouts and unconfirmed restoration. Sound preview uses audio already enabled. Preview restores parameter values only. It does not save, refresh or restart. Loading saved code requires refresh or restart.

## Optional creation-preview Host origin

The main monitor URL may carry `pndsHostOrigin=<origin>` for the adapter, set at navigation. This parameter may be absent. Preview still requires the saved-version and runtime checks.
