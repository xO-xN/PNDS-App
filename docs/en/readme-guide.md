# Writing a Project README

Write the performance introduction in the project’s root `README.md`.

## Where it appears

The main window shows the README for the selected project. Projection shows the intro until the performance starts, then switches to monitor. The README and cover travel with the `.pnds` bundle.

## The cover-page format

Place metadata at the top, then a second-level heading and introduction.

```markdown
# Work title

title: Work title
composer: Creator
duration: 10 minutes
performers: Four performers
contact: music@example.com
color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]

## Introduction

A short introduction suitable for reading before the performance.
```

Write metadata as one `key: value` per line before prose, outside lists or code fences.

| Key                                         | Purpose                             | When missing                                        |
| ------------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `title`                                     | Cover title                         | Uses the first-level heading                        |
| `composer`                                  | Author; leading @ omitted on screen | Shows —                                             |
| `duration`                                  | Duration text                       | Shows —                                             |
| `performers`                                | Performer credits                   | Shows —                                             |
| `contact`                                   | Contact text                        | Shows —                                             |
| `color_palette`                             | Four color values                   | Uses brand colors with fewer than four valid values |
| `composer_url`, `github_url`, `website_url` | Optional `http(s)://` metadata      | Optional; no link buttons on the cover              |

The cover shows only the first section, ending at a later section or the first `---`; other notes can follow it. Markdown links retain readable text, while link-only navigation paragraphs are hidden. A README without cover metadata renders as a plain document.

## Cover image cover.png

Place the cover at the project root. The App looks for `cover.png`, `cover.jpg`, `cover.jpeg`, then `cover.webp`. The limit is 4 MB.

## README language variants

Use `README.<locale>.md` for a language variant, such as `README.zh-CN.md`. The App prefers a file matching the interface language and falls back to `README.md`.

## Editing in Creation mode

Choose **Open project README** in the file panel. The App shows the file name. Recognized covers allow field and first-section edits. Switch to the text editor if the format cannot be recognized. Save explicitly before [recording a language-sync handoff](./app-tutorial.md#record-a-handoff-and-continue-externally).

## On the venue screen

Projection scales the 1200 × 800 intro proportionally. Plain documents show the full text without automatic scrolling.

## Writing notes

Markdown and GFM are supported. Raw HTML is skipped.

## Relation to the project-structure contract

The README is optional under the [project structure contract](./reference/structure.md).
