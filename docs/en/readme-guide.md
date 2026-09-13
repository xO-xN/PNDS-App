# Writing a Project README

Your project's root directory may carry a `README.md` — a one-pager written for **the people at the performance venue**. The App renders it right in its main area when the project's card is selected; the performance folder's 自述 (the intro written through the App's in-app form) is a different species — don't confuse the two. This guide is about the project-side file.

## Why it is worth writing

On the night, the operator faces a column of project cards. Select one, and the App's main area shows that project's README — no digging through directories, no calling the author. A README that says clearly "what this is, how it is performed, what to watch for" gets a stand-in operator, the venue technician, and your future self up to speed in a minute.

It is not a compliance condition: a project without one just shows an empty state, and preflight never checks it. But the App gives you that screen — use it.

## Where it appears

- **the App's main area**: selecting a project card renders the root `README.md` in the README panel on the right (since v1.5.0); to refresh after editing the file, move the selection away and back (clicking the selected card once deselects it);
- **inside the `.pnds`**: the packing exclusion list never subtracts it, so the machine on the other end sees the very same file;
- **the setlist export directory**: the `README.md` there is the **folder 自述** (synthesized from the in-app form's intro), not this project file — same name, different source.

## Recommended outline

Five parts — the first four are recommended, the fifth optional:

```markdown
# <Work title>

**Author**: <name / ensemble>

## Intro

What this work is, its instrumentation, its duration — a paragraph
for the performance operator.

## How to perform

How to start and operate it: how the pages are assigned (who
watches the performer page, who watches the monitor), interaction
gestures, how each stage advances, things to watch for.

## Technical needs (optional)

Audio mode, external equipment, networking — whatever the venue
must prepare in advance.
```

"How to perform" is the most valuable section on site: spell out the operating order and the common traps; never assume the reader sat in rehearsal.

## Bilingual READMEs

Performances cross languages; official projects MUST ship bilingual
READMEs: `README.md` (the default language) + `README.<locale>.md` (e.g.
`README.zh-CN.md`). **The App auto-selects the variant matching its UI
language** (a Chinese UI prefers `README.zh-CN.md`); with no matching
variant, or a single-README project, it falls back to the plain
`README.md` — unchanged behavior.

Give GitHub readers a language-switcher line (in-app such relative links
never navigate; clicking them is a harmless no-op):

```markdown
[中文](README.zh-CN.md) | **English**
```

Keep both READMEs on the same outline; when translation lags, update the
default-language file first.

## Writing notes

- **plain markdown**: GFM tables and fenced code blocks render; raw HTML never does — writing it is wasted;
- **keep it small**: this is a page on the wall, not technical documentation. An oversized README is refused rendering with a readable note;
- **write in the reader's language**: use the language of the place you perform in; the App's UI language does not affect the README's display;
- **leave operations detail out**: ports and protocol fields belong in the reference manual (see [structure.md](./reference/structure.md)) — the README covers "how a human gets through the performance".

## Relation to the project-structure contract

README.md is an optional file in the project structure; the full convention lives in the reference manual's [structure.md](./reference/structure.md), and the packing travel rules in [pnds-bundle.md](./reference/pnds-bundle.md). For the overall authoring walkthrough see the [Template guide](./template-guide.md).
