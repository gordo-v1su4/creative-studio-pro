# The prompt linter's rules

Every prompt goes through the operator's linter (`scripts/prompt-lint.ts`, a byte-identical copy of the app's `src/lib/domain/prompt-lint.ts`). Run it yourself before you hand a prompt over:

```
bun scripts/lint-prompt.ts <prompt.txt> --target seedance        # or --target nano_banana
bun scripts/lint-prompt.ts <prompt.txt> --target seedance --pack blood-rush --ban "lens flare"
```

`node` 22.18+ runs it too (`node scripts/lint-prompt.ts …`). An error means fix it before sending; a warning means look again. A clean prompt has zero errors.

## How it reads a prompt

The declarations at the top are variables. These forms all declare:

- `@Image_1 = Kai "Hoodie" Santana — definitive identity lock` (Seedance), `Image 1 is Kai "Hoodie" Santana.` (Nano Banana)
- `Image 1 defines Kai "Hoodie" Santana's identity, face, body, hair, and wardrobe.`
- `Image 1 and Image 2 define Kai "Hoodie" Santana's identity…` (several images, one character)
- `No image: the man on the floor — a heavyset man in a 2001 windbreaker` (anything without a picture)
- Inline, with no declaration block: `Kai "Hoodie" Santana from Image 1 walks…`

The declared name is everything before ` — `. A declaration line is never checked by the other rules, which is why a storyboard grid's look goes there (the grid exception). Text in quotation marks (dialogue, the title, a sign) is never checked either.

## The rules

| Rule | Severity | Catches | Fix |
|---|---|---|---|
| `at-sign` | error | Nano Banana: any `@` | Write `Image 1`, never `@Image 1` |
| `seedance-underscore` | error | Seedance: `@Image 1`, `@Audio 1`, `@Video 1` | `@Image_1`, `@Audio_1`, `@Video_1` |
| `unknown-handle` | error | Seedance: an `@handle` that matches no reference | Use a declared `@Image_N`, `@Audio_N` or `@Video_N` |
| `undeclared-image` | error | `Image 9` used but never declared | Declare it, or use the right number |
| `pronoun` | error | he, she, they, him, her, hers, his, their, theirs, them, himself, herself, themselves | Repeat the declared name |
| `person-alias` | error | guy, girl, boy, man, men, woman, women, person, people, figure, dude, customer, kid | The declared name, or declare `No image: …` |
| `place-alias` | error | store, shop, room, place, building, interior, storefront, location | The declared place name |
| `vague-reference` | error | "the dark store", "the dark" | The declared name |
| `partial-name` | error | `Kai` for `Kai "Hoodie" Santana` | The full declared name, every time |
| `unlabelled-name` | error | A series reference's name without its image label | `@Image_1 (Kai "Hoodie" Santana)` on Seedance, `Kai "Hoodie" Santana from image 1` on Nano Banana; the app writes these from handles |
| `banned-word` | error | A word the project's rule pack bans | Leave it out entirely, not even as "no X" |
| `project-rule` | error | A word the project's brief quotes in its must-nots | Leave it out entirely |
| `operator-rejected` | error | Everywhere: flicker, strobe, dropped frames; a drawn guide line or trajectory arc. Plus the project pack's rejections | Describe the edit pace; describe the motion, not a line |
| `black-and-white` | error | "black and white" (unless negated: "nothing is black and white") | Full colour, always |
| `re-description` | warning | Look and wardrobe words (blonde, curls, hoodie, jacket, sunglasses, tattoos…) outside a declaration | The reference already shows it; cut it |
| `single-shot` | warning | Seedance prompt with no cut at all | `Hard cut.` between shots (2.5), `Shot 2:` labels (2.0) |

## Rule packs (per project)

Some bans belong to one series, not every prompt. They live in a rule pack in the linter (`RULE_PACKS`), switched on by the project's `PROMPT-RULES.md`: either the file names the series, or it carries `<!-- lint-pack: <id> -->`.

- **`blood-rush`**: bans neon, fang/fangs/fanged, vampire/vampires/vampiric, vamp/vamped; rejects blood moon, pink or light-blue glowing signs, vial drinking, and Elias's eyes glowing.

A new series gets its own pack in `RULE_PACKS` (with a test), never new global bans.

## Why "the man" is an error even after you declared him

Video and image models bind identity to words, not to sentences. With one reference, "the man" usually lands on the right person; with two or more references, or across hard cuts, a stand-in word is a fresh, unbound person, and the model is free to invent one or to swap faces between shots. Repeating the exact declared name is what keeps each face on its own character. Nano Banana Pro is the strictest about this, which is why the same rule holds for both targets.
