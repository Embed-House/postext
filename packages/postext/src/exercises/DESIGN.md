# Exercises: design

Programme tracker: drnachio/postext#1235. Status: approved for build.

An exercise is a block of the Markdown written `:::exercise{…}` … `:::`. Its **content** (the
instruction, the questions, the options, the answers, a worked solution) is in the Markdown; its
**form** (the number badge, the option labels, how a blank prints, the writing area, where the
solutions go) is an exercise style in the configuration. The same exercise prints on the page
(canvas, Folio, PDF) and runs in the digital outputs (HTML, EPUB), where it can be answered,
checked and remembered.

## 1. What textbooks print

The typology below comes from workbooks of Spain and Latin America, France, Germany, the English
ELT and school traditions, China, Japan, the Arab world, Russia and India, mapped to the IMS QTI
3.0 interactions (the canonical taxonomy). One `type` per family.

| `type` | Families | Paper | Graded | QTI |
|---|---|---|---|---|
| `choice` | multiple choice, single or several answers; odd one out | options a) b) c), A. B. C., ア イ ウ, أ ب ج, with a box ☐, a ring ○ or a bracket `（　）` | yes | choice |
| `truefalse` | V/F, R/F, Richtig/Falsch, 判断题 √/×, ○×, صح/خطأ | statement + boxes or a bracket at the line end | yes | choice |
| `gaps` | cloze, texte à trous, Lückentext, 填空, 穴埋め, أكمل; inline choice (rodea, entoure); word bank | a line, a dotted leader, a box or brackets; `(go / goes)` | yes | textEntry, inlineChoice, gapMatch |
| `match` | une con flechas, relie, verbinde, 连线, صل; Column I / II | two columns with dots to join, or a bracket for the letter | yes | match |
| `order` | ordena, remets dans l'ordre, 並べ替え, رتب | shuffled items with a box for the number | yes | order |
| `scramble` | ordena las palabras, scrambled sentence | words in a shuffled row separated by slashes, a line under | yes | order |
| `sort` | clasifica, classe, ordne zu, 分类, صنّف | a bank of words over a table with a column per category | yes | match / gapMatch |
| `mark` | rodea, subraya, tacha; entoure, souligne, barre; 画出; markiere | a running text; the solution circles, underlines or strikes the targets | yes | hottext |
| `open` | contesta, réponds, beantworte, 简答, 記述, أجب; translation, dictation, drawing | ruled lines, a grid, a box, 田字格 | no (model answer) | extendedText |
| `wordsearch` | sopa de letras, mots mêlés, Suchsel | a letter grid + the word list | yes | custom |
| `crossword` | crucigrama, mots croisés, Kreuzworträtsel, クロスワード | a numbered grid + two clue lists | yes | custom |
| `arithmetic` | cuentas en vertical, opérations posées, schriftliches Rechnen, 竖式, 筆算, столбик | digits in columns under a rule; long division as each country sets it | yes | textEntry per cell |

Numbering conventions: a plain or bold number, a number in a disc or a square (Spain, France,
Japan, Germany), a label (`Ejercicio 3`, `Упр. 123`), sections in Chinese numerals (一、二、),
continuous through a book or restarting per chapter. Difficulty dots or stars. Activity icons (oral,
write, pair work, listen, calculator). A first item printed solved as a model.

Solution conventions: none in the pupil's book (a teacher's book, a separate key); after the
exercise; at the end of the chapter or of the book; **upside down** at the foot (puzzle books,
children's magazines, Japanese drills); a **teacher's edition** that overprints the answers in a
second colour in their slots. The digital outputs always have the solutions, whatever the print
does.

## 2. Markdown

### 2.1 The fence

```md
:::exercise{type="choice"}
Choose the right answer.

- [ ] Madrid
- [x] Lisbon
- [ ] Rome
:::
```

- `:::exercise{…}` opens, a bare `:::` closes. Attributes:
  - `type` — §1. Optional when the content says it: a task list is `choice`, `->` pairs are
    `match`, `[[…]]` is `gaps`; anything else needs it (`exerciseTypeMissing` otherwise).
  - `style` — an `exerciseStyles` id (the first style when absent or unknown, reported).
  - `title` — printed after the number.
  - `#id` — a target for `:ref` ("Exercise 3"), as a numbered box is.
  - `n` — a fixed number (a printed edition's), the counter goes on from it.
  - `level` — difficulty, 1…5, printed as the style's marks.
  - `icon` — the ids of activity icons the style defines (`icon="oral pair"`).
  - kind attributes: `select="one|many"` (choice), `columns` (options per row; match, sort, order
    rows), `lines` and `area` (open), `size` and `directions` (wordsearch), `mark`
    (`circle|underline|strike|highlight|box`), `example` (the first item prints solved), `shuffle`
    (`false` keeps the written order), `bank` (gaps: print the word bank), `points`.
- The **instruction** is the exercise's leading paragraphs, up to its first list, gap, bank or
  nested fence. It takes the style's instruction typography.
- `:::solution` … `:::` inside an exercise is its worked or model solution (any Markdown). It
  never prints in the exercise; it goes where the solutions go (§4). Graded kinds also have a key
  made from their answers.
- `:::hint` … `:::` inside an exercise is a hint the digital outputs offer on demand. Print sets it
  only when the style asks (`hint: 'print'`).

### 2.2 Answers in the text

| Syntax | Meaning |
|---|---|
| `- [x] text` / `- [ ] text` | an option, ticked when right (choice); a statement, ticked when true (truefalse). `[X]` counts. |
| `[[water]]` | a blank whose answer is *water* |
| `[[colour \| color]]` | a blank with accepted answers |
| `[[go \| (goes) \| going]]` | an inline choice: the one in parentheses is right |
| `- Bee -> Hive` | a pair (match); `- -> Cave` is a distractor of the right column; `→` counts |
| `1. …` in written order | the right order (order); shuffled to print |
| `- She / goes / to school` | a sentence whose pieces (split at ` / `, else at spaces) are shuffled (scramble) |
| `- Mammals: dog, whale, bat` | a category and its items (sort); `、`, `，` and `،` separate too |
| `[[word]]` in a `mark` exercise | a word to mark; `[[word]]{mark=underline}` marks it another way |
| `- WORD` | a word to find (wordsearch) |
| `- WORD: clue` | an entry and its clue (crossword) |
| `- 345 + 278` | an operation (arithmetic): `+ - − × x * ÷ : /` |
| `::bank[sun \| rain]` | the word bank goes here, with *sun* and *rain* added as distractors |

Several questions in one exercise are an ordered list whose items are the stems, the options a
nested task list under each:

```md
:::exercise{type="choice" columns=3}
Choose the right answer.

1. The capital of Portugal is
   - [ ] Madrid
   - [x] Lisbon
   - [ ] Porto
2. She [[go | (goes)]] to school by bus.
:::
```

`[[…]]` is read only inside `:::exercise`, so it changes no other document. A literal `|` in an
answer is `\|`. Answers keep their inline Markdown (maths, ruby, small capitals).

## 3. Configuration

### 3.1 `exerciseStyles[]`

A style is the form of a family of exercises; one ships by default (`exercise`), so the fence works
with no configuration. `extends` as box styles have it. Fields (all optional):

- `box` — a `calloutStyles` id for the frame (background, border, stripe, padding, splitting,
  placement). Default: no frame, the exercise in the running text.
- `number` — `{ show, label, template, shape: 'none'|'disc'|'square'|'rounded'|'tab', color,
  background, fontFamily, fontSize, fontWeight, counter, resetOn, counterFormat, suffix }`.
  `label` defaults to the document language's word ("Exercise", "Ejercicio", "练习"…) only when
  `shape` is `'none'` and `label` is asked for (`label: true`); a shaped number prints the number
  alone.
- `instruction` — `{ bold, italic, color, fontFamily, fontSize, uppercase }`.
- `options` — `{ labels: 'lower-alpha'|'upper-alpha'|'decimal'|'katakana'|'iroha'|'arabic-abjad'|
  'none', prefix, suffix, marker: 'none'|'box'|'circle'|'bracket', layout: 'stack'|'row', columns,
  shuffle }`.
- `blank` — `{ look: 'line'|'dots'|'box'|'brackets', width: 'answer'|'longest'|<Dimension>,
  minWidth, color, weight, numbered }` (numbered: ① ② under the blank, for keys in a grid).
- `trueFalse` — `{ labels: [true, false] (language default V/F, R/F, ✓/✗, √/×, ○/×, ص/خ),
  look: 'boxes'|'bracket', place: 'end'|'start' }`.
- `match` — `{ look: 'dots'|'letters', gap, dot: { size, color } }`.
- `bank` — `{ box: <calloutStyles id>, separator, order: 'shuffle'|'alpha'|'written' }`.
- `area` — `{ kind: 'lines'|'dots'|'grid'|'seyes'|'tianzige'|'box'|'none', lines, spacing,
  color, weight }`.
- `grid` — `{ cell, fontFamily, fontSize, color, rule, background }` (wordsearch, crossword,
  arithmetic cells).
- `arithmetic` — `{ division: 'bracket'|'potence'|'inline', carries }`.
- `level` — `{ glyph, empty, color, max }` (●○, ★☆).
- `icons` — `{ [id]: { resourceId } | { glyph, fontFamily } }`.
- `answers` — `{ color, fontFamily }`: how answers print in a teacher's edition and in the key.
- `solution` — `{ placement, box, heading }` over `exercises.solutions`.
- `digital` — `{ check: 'button'|'instant', correctColor, wrongColor }`.

### 3.2 `exercises`

Book-wide settings: `{ edition: 'student'|'teacher', solutions: { placement:
'none'|'after'|'inverted'|'chapterEnd'|'directive', box, heading, layout: 'key'|'full' },
seed, digital: { interactive, persist, revealSolutions } }`. `placement`:

- `none` — no solutions in print (the digital outputs still have them).
- `after` — right after the exercise.
- `inverted` — right after the exercise, turned 180°.
- `chapterEnd` — collected at the end of the chapter under `heading`.
- `directive` — only where a `:::solutions` line stands (`scope="chapter"` or `"book"`).

`edition: 'teacher'` overprints every answer in its slot (`answers.color`), draws the matching
lines and rings the right options: a teacher's book from the pupil's text.

Words the engine prints (the number label, true/false labels, the solutions heading, the digital
buttons) default to the document language, as resource-type names do.

## 4. Engine

- **Parser** (`parse/blockParser.ts`): `exercise`, `solution` and `hint` join `KNOWN_CONTAINERS`;
  `solutions` joins the one-line directives; inside an open exercise `[[…]]` becomes a gap span (a
  chip span with `gap`), `::bank[…]` a bank directive. Every name list that copies the container
  names learns them.
- **Model** (`exercises/model.ts`): `readExercises(blocks)` gives each exercise its kind, items,
  answers, number, key — pure data, the same for print and digital, with a seeded shuffle
  (`seed` + the exercise's ordinal) so print, HTML, EPUB and the key agree.
- **Expansion** (`exercises/expand.ts`), a block transform in `build.ts` before statement numbering:
  each exercise becomes a synthetic box (`__postext-exercise-<style>`, a callout style derived
  from `box`) holding ordinary blocks — the instruction as a paragraph run, options as paragraphs
  with a hanging label, blanks as chips, answer areas as ruled spaces, grids as table resources —
  so placement, splitting, columns, balancing, tagging and every renderer work as for any box.
  Solutions are emitted where `placement` says, built from the model.
- **New primitives**: a chip may be a blank (its text sized but not painted, read as "blank"),
  underlined or dotted instead of boxed; a ruled writing area; a box turned 180°.
- **VDT**: `VDTDocument.exercises` carries the model of each exercise laid out (answers
  included); chips, option markers and grid cells carry `exercise` hit data (exercise id, item,
  part) so the digital outputs can find them on the page.

## 5. Digital outputs

- **HTML** (positioned pages): `renderToHtml` marks the exercise elements (`data-pt-ex`,
  `data-pt-gap`, `data-pt-opt`, `data-pt-cell`) and writes the models in a
  `<script type="application/json">`. `attachExercises(root, options)` (and the standalone
  `EXERCISE_SCRIPT`) puts inputs over the blanks, makes options, dots and cells answerable, adds a
  Check / Show solution / Reset bar per exercise, says right or wrong (colour and a mark, with
  `aria-live`), and keeps the answers in `localStorage` per book.
- **EPUB**: fixed layout as HTML; reflowable as semantic XHTML with real inputs. Both link the
  script (`scripted`) and keep a static fallback: the answer key is always in the book.
- **Folio, canvas, PDF**: the page as printed.

## 6. Checks

Content warnings (`collectContentWarnings`): `exerciseUnknownType`, `exerciseUnknownStyle`,
`exerciseNoAnswer`, `exerciseUnreadItem`, `exerciseNested`, `exerciseWordUnplaced` (a word a
crossword or word search could not place), `solutionOutside`.

## 7. What the engine built (#1225–#1229)

Fence attributes read: `type`, `style`, `title`, `n`, `#id`, `level`, `icon`, `columns` (choice
options n to a row), `select="one|many"`, `lines` and `area` (open), `size` and `directions`
(`across down diagonal backwards`, wordsearch), `hidden` (wordsearch: no word list), `mark`
(`circle|box|underline|highlight`, also per word `[[w]]{mark=…}`), `example` (the first item
printed answered and not asked), `shuffle=false` (match, order), `bank` (gaps). A gap takes
`{width=N}` (N ems). `:::solutions{scope="chapter"|"book" title="…"}`.

- Expansion (`expand.ts`): the exercise's outer box keeps the fence's container id; drawn parts
  are nested boxes with a design (`designs.ts` areas, `grids.ts` match/wordsearch/crossword/
  arithmetic). Text parts are `:::paragraphs` groups in synthetic paragraph styles (`styles.ts`:
  instruction, text, option, option-under, row-1…6, item, statement, pairs, key) with chips in
  synthetic chip styles (number, level, icon, blank, blank-answer, choice, choice-ring, tick,
  tick-on, rank, rank-answer, word, answer, mark, mark-on[-box|-underline|-highlight]).
  `withExerciseStyles(resolved)` adds the chip and paragraph styles of every exercise style to
  the resolved config of a document that has exercises; `ResolvedConfig.exerciseSettings` holds
  the resolved styles and book settings when the config sets them.
- Chips gained `underline` and `minWidth` (styles) and `widthText`, `blank`, `blankLabel`,
  `exercise` (spans): a blank is laid out with its answer and not painted.
- Solutions: `after` and `inverted` print a box after the exercise (`turn="180"` on the fence of
  the synthetic box; `VDTBlock.turn` set by `markTurnedBoxes`, painted rotated by the canvas,
  PDF and HTML painters); `chapterEnd` lists them before the next `#` heading under
  `solutions.heading`; `directive` keeps them for the next `:::solutions`; `scope="book"` prints
  the `exercise` entries of the book's outline (`contentOutline` adds them and reports
  `hasIndex` for such a chapter, so hosts pass the outline).
- Numbering: per style counter (`number.counter`), reset by `number.resetOn`, carried between
  chapters in `LayoutContinuation.statementCounters` under `exercise:<counter>`.
- Records (`record.ts`, `VDTDocument.exercises`): slots per item for the digital outputs.
