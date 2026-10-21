# Contributing to Wrambi

Thank you for helping. Wrambi is a small project, so a short issue that describes what you expected and what happened is already very useful.

## Before you start

- **Bugs:** say which system you use (Windows, macOS or Linux, and its version) and what you were doing. Attach the file only if it holds nothing private.
- **Ideas:** open an issue first, so we can agree on the approach before you write code. Wrambi tries to stay calm and focused, so not every good feature belongs in it.
- **Translations:** see below. New languages are welcome.

## Setting up

You need Node.js 20+ and Rust 1.92+, plus:
- on Windows, the Visual Studio Build Tools with *Desktop development with C++*;
- on macOS, the Xcode command line tools (`xcode-select --install`);
- on Debian/Ubuntu, `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential`.

```sh
npm install
npm run app        # the app, reloaded on every interface change
npm run dev        # only the interface, in a browser, with simulated files
```

`npm run dev` needs no Rust at all and is the fastest way to work on the interface. It uses a simulated library: nothing on your disk is read or written.

## Before opening a pull request

```sh
npm run check      # svelte-check: no errors and no warnings
npm test           # Vitest
npm run test:rust  # cargo test
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

The same checks run on GitHub for every pull request.

## Translations

Italian is the source language: every interface string is written in Italian inside `t('…')` (or `tn(n, 'one', 'many')` for plurals, `tk('…')` for constants translated later), and the Italian sentence is the key.

- `src/lib/i18n/en.ts` and `src/lib/i18n/fr.ts` map each Italian sentence to its translation. Placeholders such as `{name}` must stay the same.
- `node scripts/i18n-keys.mjs --missing en` lists the sentences that have no English translation yet (same for `fr`).
- `tests/i18n.test.ts` fails if a sentence used in the code has no translation, or if placeholders differ.
- The core's own messages (file errors, vault, Typst) are in `src-tauri/src/i18n.rs`.

To add a language: copy `en.ts` to a new file, translate the values, add it to `LANGS` and `DICTS` in `src/lib/i18n/index.ts`, to the test, and to the table in `i18n.rs`.

## Guidelines

- **Keep the user's files safe.** Write through the existing helpers: atomic writes, conflict checks, and never overwriting without asking. Never move or delete a user's file unless they asked for it.
- **Be honest in the interface.** When a conversion loses something, say what is lost.
- **Keep typing fast.** Heavy work (conversion, PDF compilation) runs off the main thread or in Rust. Measure if you are unsure.
- **Code comments** are written in Italian, like the rest of the code base; English is fine in new code if you prefer it.
- **All three systems.** Wrambi runs on Windows, macOS and Linux: avoid system-specific paths and shortcuts (use `Mod-` in CodeMirror, `keys()` to show shortcuts, `PLATFORM` from `src/lib/platform.ts` when behaviour must differ).
- **Tests:** add a test for any parsing, conversion or file-handling change.

By contributing you agree that your contribution is released under the [MIT License](LICENSE).
