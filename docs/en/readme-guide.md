# Writing a Project README

Your project's root directory may carry a `README.md` — a one-pager written for **the people at the performance venue**. It has two audiences: the **preparer at the sidebar** (the operator, the venue technician) and the **audience sitting in front of the venue screen before the show starts** (since v1.5.0 the projection window's intro shows the very same file — see "On the venue screen"). When the project's card is selected, the App renders it as a **cover page**: the huge title, the composer pill, the four-dot mark's colors, the cover image and the section text are all composed by the App — you only fill in the format (see "The cover-page format"). The performance folder's 自述 (the intro written through the App's in-app form) is a different species — don't confuse the two. This guide is about the project-side file.

## Why it is worth writing

On the night, the operator faces a column of project cards. Select one, and the App's main area shows that project's cover page — no digging through directories, no calling the author. A README that says clearly "what this is, how it is performed, what to watch for" gets a stand-in operator, the venue technician, and your future self up to speed in a minute.

It is not a compliance condition: a project without one just shows an empty state, and preflight never checks it. But the App gives you that screen — use it.

## Where it appears

- **the App's main area**: selecting a project card renders the root `README.md` in the README panel on the right (since v1.5.0); to refresh after editing the file, move the selection away and back (clicking the selected card once deselects it);
- **the projection window's intro** (since v1.5.0): until the projection start (▶ / ⌘⏎), the venue-screen projection window shows the same README — it is the first screen the arriving audience sees; see "On the venue screen" for how to write for it;
- **inside the `.pnds`**: the packing exclusion list never subtracts it, so the machine on the other end sees the very same file;
- **the setlist export directory**: the `README.md` there is the **folder 自述** (synthesized from the in-app form's intro), not this project file — same name, different source.

## The cover-page format

The README has two parts: everything before the `---` feeds the App's cover page; everything after it (optional) is boilerplate for GitHub readers. Full skeleton:

```markdown
# Inarticulate III

[中文](README.zh-CN.md) | **English**

title: Inarticulate III
composer: @XiaoXiang
composer_url: https://…
github_url: https://github.com/…
color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]

## Description:

<one freely written section — the cover page band's text>

---

## About the Work

<the fixed PNDS boilerplate below — copy it verbatim>
```

The metadata lines sit at the top, before any prose — they are not markdown syntax; write them verbatim, one `key: value` per line:

| Key             | Purpose                                                               | When missing                                                             |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `title`         | the cover page's huge title                                           | falls back to the README's H1                                            |
| `composer`      | the composer pill top-right (e.g. `@XiaoXiang`)                       | the pill is not shown                                                    |
| `composer_url`  | the pill becomes a button opening it in the default browser           | the pill shows but is not clickable                                      |
| `github_url`    | a `github` button joins the header, opening the repository            | the button is not shown                                                  |
| `color_palette` | the four-dot diamond mark's colors, in order left, top, right, bottom | fewer than four valid `#hex` values falls back to the App's brand colors |

Both URL keys accept `http(s)://` addresses only — anything else (`ftp:`, a mistyped string) is treated as missing and never handed to the browser.

Rules:

- **only the first section reaches the cover page**: you name the heading ("Description:", "How to perform:" — your call) and write the body freely; the panel's content ends at the first `---`;
- **after the `---` nothing enters the panel**: that part is for GitHub readers; official projects use this boilerplate —

```markdown
## About the Work

This work is a PNDS project. PNDS (Platform for Networked Digital Score) is an open platform for networked digital music performance, used to create, run, and organize multi-performer digital score works: a creator organizes a digital score, a sound engine, and a set of network interaction rules into a self-contained performance project, and [PNDS App](https://github.com/xO-xN/PNDS-App) (a macOS desktop application) turns it, at the performance venue, into a running local multi-performer digital music performance system.
```

- **the language-switcher line** stays at the top (see the example in "Bilingual READMEs"): it is for GitHub readers; the App auto-selects the variant for its UI language, and such relative links are harmless no-ops in-app;
- **legacy formats are untouched**: a README without the metadata block renders as a plain document — old projects need no changes.

## Cover image cover.png

The cover page band's left side is a square cover image — the creator's screenshot of the work. The cover lives at the project root, named `cover.png` (the App probes `cover.png` → `cover.jpg` → `cover.jpeg` → `cover.webp` in order — first hit wins):

- **1:1 square recommended**: the panel shows the image as a square, and 1:1 is never cropped at any window width;
- **pick the frame that says "this work"**: the monitor page's generative graphics or a performer page mid-performance say more than a directory listing ever will;
- **keep it light**: stay within about 2 MB — a performance machine should never wait on a picture (the hard cap is 4 MB; beyond it the image is refused);
- **language-agnostic**: covers carry no locale variants; one image serves every language;
- with no cover the band shows text only and nothing else changes; it travels inside the `.pnds` verbatim, just like `README.md`.

## Bilingual READMEs

Performances cross languages; official projects MUST ship bilingual READMEs: `README.md` (the default language) + `README.<locale>.md` (e.g. `README.zh-CN.md`). **The App auto-selects the variant matching its UI language** (a Chinese UI prefers `README.zh-CN.md`); with no matching variant, or a single-README project, it falls back to the plain `README.md` — unchanged behavior. Write both files in the cover-page format above, each with its own language's metadata.

Give GitHub readers a language-switcher line (in-app such relative links never navigate; clicking them is a harmless no-op):

```markdown
[中文](README.zh-CN.md) | **English**
```

Keep both READMEs on the same structure; when translation lags, update the default-language file first.

## On the venue screen

Until the projection start (▶ / ⌘⏎), the projection window holds its **intro** — and the intro shows this README: the cover-page format shows the cover page (the huge title, the band); a plain README shows the full, static document view. The first screen the arriving audience sees is what you wrote, which adds one discipline to everything that goes up:

- **do not spoil the score's visuals, structure, or key interactions.** Suspense is part of the performance: what the monitor will look like, how the score pages turn, which gesture triggers what — leave those for the audience to live through after the start. What goes on screen says what the work **is** — instrumentation, duration, character; "how it is played" is for the operator (below).
- **write for a standing skim.** The cover band's text auto-scrolls slowly when it overflows, but a paragraph readable while standing beats an endlessly crawling wall; a plain README's document view does **not** auto-scroll — what fits the first screen is all that shows. Compress long content, or move it past the cover format's `---` (that part never goes up).
- **keep operator-facing content out of the on-screen zone.** The cover-page format contains it naturally: the "How to perform" and "Technical needs" sections after the first never reach the projection; a plain README puts the **whole file** on screen — if yours carries operational detail, switch it to the cover-page format or move what the audience shouldn't see yet past the `---`.
- **the bilingual variant follows the App's UI language.** The intro opens the same variant as the main window's panel — whichever language the operator sets the App to is the one the audience sees. The venue's language should decide which variant you verify for the screen (see "Bilingual READMEs").

A first-section example (audience-facing, screen-safe):

```markdown
## Description:

Inarticulate III is written for five performers and a live sound
field, lasting about 14 minutes. Voice, percussion, and three
instruments answer one another under the direction of a networked
score, the sound field slowly reshaping as the performers move —
a chorus about what cannot be said.
```

## Writing notes

- **metadata lines go at the top, never inside a code block or list** — the App recognizes the cover format by them; wrap them and the file degrades to the plain document view;
- **the body is plain markdown**: GFM tables and fenced code blocks render; raw HTML never does — writing it is wasted;
- **keep it small**: only the first section enters the panel, but keep the whole file in check. An oversized README is refused rendering with a readable note;
- **self-check what goes on screen**: the cover format's first section is projected to the arriving audience — make sure it passes the no-spoiler rule before you finalize it (see "On the venue screen");
- **write in the reader's language**: use the language of the place you perform in; the App's UI language picks which variant opens, it never edits the content;
- **leave operations detail out**: ports and protocol fields belong in the reference manual (see [structure.md](./reference/structure.md)) — the README covers "how a human gets through the performance".

## Relation to the project-structure contract

README.md is an optional file in the project structure; the full convention lives in the reference manual's [structure.md](./reference/structure.md), and the packing travel rules in [pnds-bundle.md](./reference/pnds-bundle.md). For the overall authoring walkthrough see the [Template guide](./template-guide.md).
