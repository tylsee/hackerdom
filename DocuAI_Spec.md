# DocuAI — Product Specification

**Do it once. Document it automatically.**

DocuAI turns a single screen recording — or a folder of screenshots — into a finished, editable  
document: a lab report, an SOP, a tutorial, or a recipe. The user demonstrates the task once.  
DocuAI reads the screen, keeps the frames that matter, writes the captions and instructions,  
and hands back a document anyone else can follow.

---

## 1. The problem

People constantly need to turn something they *already know how to do* into something *someone else  
can follow*. Today that means manually capturing screenshots, sequencing them, writing captions,  
and fighting with Word formatting.

### The concrete pain points we are attacking

| Pain point                              | What people do today                                      | Why it hurts                                                  |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| **Screenshot chaos**                    | 40 screenshots in a camera roll, named `Screenshot_2026…` | Nobody knows which order they go in, or which ones matter     |
| **"What do I write under the figure?"** | Stare at a screenshot, type something vague               | Captions are graded. "Picture of the setup" scores nothing    |
| **Formatting drudgery**                 | Rebuild the same structure in Word every time             | 30 minutes of typing for a task they already performed        |
| **Knowledge trapped in one head**       | WhatsApp voice notes, verbal instructions                 | The one person who knows becomes a bottleneck                 |
| **Inconsistent numbering**              | Manual "Figure 1", "Figure 2"                             | Numbers drift when a figure is inserted; marks are lost on it |

### The insight that shapes the product

The hard part is **not doing the task**. It is the repetitive work of turning that knowledge into  
clear, structured, reusable documentation. And the deeper problem is **trust**: a student submitting  
a report, or a supervisor circulating an SOP, has to be able to believe every step is real.

> **DocuAI's real value is knowledge transfer, with time saved as the bonus.**  
> The strongest pitch is not "AI saves you taking screenshots."  
> It is: *when only one person knows how to do something, DocuAI turns that into instructions  
> everyone else can follow.*

---

## 2. Target users

| User                           | Real-world situation                                    | What DocuAI produces                                     |
| ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------- |
| **Student**                    | Recording themselves completing a practical lab         | Lab report with numbered figures and explanations        |
| **Lecturer**                   | Demonstrating how to configure software for a tutorial  | Illustrated teaching tutorial                            |
| **Factory owner / supervisor** | Filming how to operate a machine so staff can repeat it | SOP with numbered steps, safety callouts and checkpoints |
| **Small business owner**       | Showing how to process customer orders                  | Employee training manual                                 |
| **Home cook / maker**          | Filming themselves baking cookies to send to a friend   | Recipe with ingredients, method and tips                 |

**Primary persona for the hackathon demo:** the student doing a lab practical.  
It is the most relatable, and the pain (figures + captions + ordering) is the sharpest.

---

## 3. Product principles

These are not nice-to-haves. They are the rules that make the product defensible.

1. **Read the screen, not the narration.**  
   Most recordings have no captions, no voiceover, no subtitles. The AI must understand what is  
   *on screen*. Never assume a narration track exists.
2. **Never invent a step.**  
   If the transition between two steps is not visible, flag it as `unverified` and say so.  
   Guessing is worse than admitting the gap. This is the core promise and the thing judges remember.
3. **The category decides the voice.**  
   The user picks Education / Work / Personal once, on the first screen. Everything downstream —  
   tone, section structure, caption format, safety conventions — follows from that one choice.  
   The user is never asked "how formal do you want this?"
4. **Every step traces back to a frame.**  
   Each generated step points at the frames it came from. This is what makes the output trustworthy  
   rather than merely plausible.
5. **Hand back something editable.**  
   A document the user cannot fix is a document they cannot submit.

---

## 4. Categories

Three categories, chosen on screen one. They share **one pipeline** — the only differences are the  
prompt set and the section template. Do not build three products.

| Category      | Voice                                          | Built-in template | Doc types                             |
| ------------- | ---------------------------------------------- | ----------------- | ------------------------------------- |
| **Education** | Academic, passive voice, formal register       | Report template   | Lab report · Tutorial · Assignment    |
| **Work**      | Imperative, short steps, safety-first ordering | SOP template      | SOP · Training manual · Process guide |
| **Personal**  | Warm, plain language, second person            | Recipe template   | Recipe · How-to guide · Care guide    |

---

## 5. User flow

A strict wizard. Step N cannot be reached before step N-1 is satisfied.

```
Screen 0  Choose category          Education / Work / Personal + doc type + looping intro video
Screen 1  Evidence                 upload video (any length) + optional screenshots
Screen 2  Context                  type the brief, or upload a rubric / manual / photo of one
Screen 3  Template                 built-in template, or upload your own → section mapping
Screen 4  Generating               progress, stage-by-stage, cancellable
Screen 5  Editor                   read, edit, format, export
```

---

## 6. Functional requirements

### Screen 0 — Choose category

- Three category cards, each with 2–3 selectable doc-type chips inside
- Each card states plainly what kind of document it produces and at what reading level
- Looping, silent intro video below the cards showing the full workflow  
  (`intro.mp4`, muted, autoplay, loop, ~15–25s screen recording)
- Category badge stays visible in the top bar for the rest of the session

### Screen 1 — Evidence

- Video upload: `MP4 / MOV / MKV`, **any length**
- Screenshot upload: `PNG / JPG`, optional, for steps the video missed
- Client-side duration read → immediately show  
  `length · frames expected to keep · whether it will be split into segments`
- Extraction settings, all on by default:
  - **Capture on change** — a frame is kept only when the screen meaningfully changes
  - **Drop near-identical frames** — long recordings contain hundreds of duplicates
  - **Split long recordings** — over ~20 minutes is processed in segments and stitched by timestamp
  - **Flag sensitive data** — passwords, IDs, personal details
- Explicit reassurance: *your recording does not need captions, narration or subtitles*
- Continue is disabled until at least one file is present

### Screen 2 — Context (optional, skippable)

- Free-text box for the brief
- One-tap chips that append common requirements  
  (Education: results table, error discussion, hypothesis, list of figures, references /  
  Work: PPE, checkpoint, revision history, escalation contact, machine ID /  
  Personal: quantities, prep & cook time, serving size, substitutions, storage tips)
- Upload the source of truth: `DOCX / PDF / TXT / PNG / JPG` — **a photo of a printed rubric must work**
- Skipping is allowed; the UI states honestly that the AI will then not know the marking scheme

### Screen 3 — Template

- Two options only: **use our template** (name follows the category) or **upload your own**
- Uploading a `.docx` → headings are parsed → a **section mapping** table appears:  
  left column is the heading found in the template, right column is a dropdown of DocuAI's sections,  
  with an `auto` / `check` confidence tag
- Side panel lists everything applied automatically from the category choice

### Screen 4 — Generating

- Five stages, each revealing a concrete result when it completes  
  (frames kept vs. dropped, steps drafted, figures and captions written, verification outcome)
- Rotating tips while the user waits
- Cancel returns to screen 3

### Screen 5 — Editor

- `contenteditable` document body
- Word-like toolbar: font family, size, bold / italic / underline / strikethrough,  
  four alignments, bullet and numbered lists, undo / redo, per-paragraph **Re-generate**
- **Download buttons live in the toolbar**: `Word` (.docx, editable) and `PDF` (final)
- Clickable table of contents generated from headings; scroll-to on click, active section  
  highlighted while scrolling
- Evidence panel: steps, figures, verified count, flagged count
- Clicking a flag jumps to the flagged text in the body and flashes it
- AI-uncertain text is visually distinct (yellow background, dotted underline) from user-written text
- Autosave with a visible `Saving… → All changes saved` state

---

## 7. Figure and caption conventions

The category decides the convention. The user never configures this.

|                   | Education                              | Work                                             | Personal                     |
| ----------------- | -------------------------------------- | ------------------------------------------------ | ---------------------------- |
| Numbering         | `Figure 1`, `Figure 2`                 | `Step 01`, `Step 02`                             | `Step 1`, `Step 2`           |
| Caption format    | `Figure N: description`                | imperative sentence                              | `Step N — what is happening` |
| In-text reference | required ("As shown in Figure 3")      | not used                                         | not used                     |
| On-image callouts | no                                     | numbered callouts on each image                  | no                           |
| Checkpoints       | no                                     | after every critical step                        | no                           |
| Front matter      | Title, course, date, student, lecturer | Doc no, version, effective date, owner, approver | Prep time, cook time, yield  |
| Back matter       | References, list of figures            | Verification table, revision history             | Tips, storage notes          |

---

## 8. AI behaviour rules

These must be enforced in the backend, not left to chance:

1. **Scene-change extraction, never uniform sampling.**  
   `ffmpeg -filter:v "select='gt(scene,0.25)'"`. Threshold adapts to video length.
2. **Perceptual dedupe** (dHash/pHash) — drop frames within Hamming distance < 5.
3. **Long-video segmentation** — split, extract in parallel, then **merge by timestamp**.  
   Getting this wrong silently scrambles step order.
4. **Unverified over invented.** A step with no legible evidence is emitted with  
   `level: "unverified"` and a human-readable explanation of what was missing.
5. **Sensitive data detection** — regex + visual heuristic; hits become flags, never silent redactions.
6. **Graceful degradation** — one unreadable frame must not fail the whole job.

---

## 9. Architecture and contract

Frontend and backend communicate through one JSON contract. The full API table, the document JSON


schema, the three boundary decisions, and the milestone plan live in:

**`FRONTEND_BACKEND_SPLIT_EN.md`**

Key decisions already settled:
- The **backend** builds the `.docx` (python-docx); the frontend edits an HTML preview and posts
  sections JSON back on export
- The **backend** owns long-video splitting and timestamp stitching
- Write-back granularity is the **section**, never the whole document

---

## 10. Out of scope

Cut deliberately to protect the deadline:

- ~~**Evidence pack** (.zip of frames + step manifest)~~ — removed. Nice for traceability
  storytelling, not worth the implementation time
- **PDF as a visual editor surface** — PDF is export-only
- **OCR of physical procedures** — DocuAI flags missing actions instead of claiming to see them
- **Collaboration, comments, accounts, versioning between users**
- **Mobile-native app** — responsive web is enough
- **More than three categories** — three prompt sets is the ceiling; beyond that it becomes
  three products

---

## 11. Hackathon demo script

1. Open on screen 0. Say: *"One recording in, one finished document out."*
2. Pick **Education → Lab report**. Upload the recorded lab session.
3. Step 2: paste a short brief. **Point out that the recording has no narration** — this is the
   moment the room understands the difficulty.
4. Step 3: choose the built-in Report template.
5. Generating: let the stages land one by one. The numbers ("263 near-identical frames dropped")
   do a lot of work here.
6. Editor: click a TOC entry, click a flag and watch it jump into the body, bold a heading.
7. **Switch to Work → SOP** and regenerate from the same idea to show the voice change.
8. Close on: *"Two steps were flagged, not invented. That's the difference between a document
   you can submit and one you can't."*

**Keep the fully-mocked frontend.** If the network fails on stage, you still have a complete
experience to walk through — and judges read a complete experience far better than a working endpoint.

---

## 12. Open questions

1. Do we let users re-order steps by dragging, or is flagging enough for v1?
2. Do we regenerate the whole document or just one section when the user edits and hits Re-generate?
   (Recommendation: section only.)
3. Do we need Bahasa Melayu output alongside English and Chinese?
4. What is the hard cap on video length for the demo environment?
