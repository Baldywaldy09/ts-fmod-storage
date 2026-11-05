# ts-fmod-storage

Release storage for [TS-FMOD](https://github.com/Baldywaldy09/ts-fmod-plugin-v2): the plugin builds TS-FMOD Manager installs, and the one file that tells it what's available.

TS-FMOD Manager reads two files from this repo:

```
https://raw.githubusercontent.com/Baldywaldy09/ts-fmod-storage/main/app.json        the manager itself
https://raw.githubusercontent.com/Baldywaldy09/ts-fmod-storage/main/manifest.json   plugin releases and notices
```

## Layout

```
app.json                       the current manager version and its download page
manifest.json                  plugin releases and notices
schema/                        JSON schemas for both
plugin/<version>/              one folder per plugin release, laid out like the game's bin/win_x64/plugins
  ts-fmod-plugin-v2.dll
  ts-fmod-plugin-v2/builtin/...
tools/publish.mjs              writes releases and keeps manifest.json in step
```

Releases are plain files, not archives. Every file has its size and SHA-256 in the manifest; the manager downloads a release into its own cache, checks each file, and only installs a release that matches completely. A release folder is never changed after it's published: a fix is a new version.

## app.json

| Field | |
|---|---|
| `schema` | `1` |
| `version` | The current TS-FMOD Manager |
| `date`, `notes` | Shown on the update screen |
| `url` | The download page, opened in the browser |

**Every update is mandatory.** A manager older than `version` shows a full-window "Update required" screen and refuses everything else until it has been updated: it only offers the link, a re-check and Quit. It never downloads or installs itself. It caches the last `app.json` it saw, so going offline doesn't get around it.

## manifest.json

| Field | |
|---|---|
| `schema` | `1`. Only bumped for breaking changes; a manager ignores a manifest with a newer schema than it knows |
| `plugin.channels` | `stable` / `beta`: the version each channel installs |
| `plugin.releases[]` | Newest first. `version`, `date`, `base` (folder in this repo), `notes`, `min_app`, `verified_builds` (game builds every offset was checked against), `files[]` (`path`, `size`, `sha256`) |
| `notices[]` | Messages shown in the manager: `id`, `level` (`info`, `warn`, `danger`), `title`, `body`, `until` (hidden after that date) |

## Publishing

Node 18 or later, no dependencies.

```
# a plugin build: the plugin's CMake stage folder; the version comes from the DLL
node tools/publish.mjs plugin ../ts-fmod-plugin-v2-remake/plugin/build/stage/plugins --notes "What changed"

# a beta, which only managers on the beta channel install
node tools/publish.mjs plugin <stage> --channel beta --notes "..."

# a new manager release: every older manager is locked until it updates, so upload the
# installer to the download page first
node tools/publish.mjs app 2.1.0 --url https://github.com/Baldywaldy09/ts-fmod-storage/releases/tag/app-2.1.0 --notes "..."

# a notice, e.g. after a game update
node tools/publish.mjs notice game-1.62 warn "ETS2 1.62" "The plugin hasn't been checked on 1.62 yet. Engine features stay off until it has." --until 2026-12-31

# check every file against the manifest, and app.json, before pushing
node tools/publish.mjs verify
```

Then commit and push. Managers pick it up on their next check (at start and every few hours).

`builtin/` holds the game's own `master.bank` for each game (ETS2 `eut2`, ATS `ats`), which the plugin loads to give packs the game's bus layout, and the backup warning sounds.
