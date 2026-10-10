# DocuAI — Design Beautification Brief (for a Work-mode session with Mobbin)

Two parts:

1. **The prompt** — copy the block in section 1 and paste it into a new session running in Work mode  
   with Mobbin available. It is written to be self-contained, so it works on its own.
2. **The appendix** — the design direction in more detail. Keep it in the same folder so the session  
   can read it if you want it to go further.

---

## 1. Prompt — copy from here

```
I have a working clickable prototype of a web app called DocuAI and I want you to redesign it
visually so it looks like a real, funded product. Functionality must stay exactly as it is.

WHAT THE APP DOES
DocuAI turns one screen recording (or a set of screenshots) into a finished document — a lab report,
an SOP, or a recipe. The user uploads a video, answers two short steps, waits while the AI works,
then edits and downloads the result. Six screens: category choice, upload, context, template,
generating, editor.

THE FILE
Rewrite this single file: C:\Users\User\WorkBuddy AI\2026-10-10-19-26-57\docuai-prototype\index.html

Also read these for context before you start:
- DocuAI_Spec.md          (full product spec — users, principles, flow, features)
- FRONTEND_BACKEND_SPLIT_EN.md  (technical contract — read section 0 for the product shape)

STEP 1 — RESEARCH WITH MOBBIN FIRST
Use Mobbin to find real reference patterns before you design anything. Search for and study:
- "onboarding category selection" / "role picker"  → for screen 0
- "file upload dropzone" / "drag and drop upload"  → for screen 1
- "multi step wizard" / "stepper progress"         → for the wizard chrome
- "AI generation loading screen" / "processing state" → for screen 4
- "document editor toolbar" / "rich text editor"   → for screen 5
- "empty state" / "success state"                  → general polish
Pull 2-3 concrete patterns per screen and note what each one does well. Then apply what you learned.
Do not just describe the patterns — use them to make specific decisions about spacing, hierarchy,
and where the eye goes first.

STEP 2 — REDESIGN
Design direction:
- Clean, confident, modern SaaS. Think Linear / Notion / Vercel — calm surfaces, one strong accent,
  generous whitespace, nothing decorative for its own sake.
- Light theme only. Light backgrounds, dark text. Do not introduce dark panels.
- One accent colour, used sparingly and consistently. Everything else is neutral grey.
  Reserve colour for: primary action, selected state, and warnings.
- Replace the current gradient-heavy indigo look with something more restrained and expensive-feeling.
- Real typographic hierarchy: one clear page title, obvious section titles, muted supporting text.
  Tighten the type scale so headings and body are clearly different sizes.
- Consistent spacing rhythm — pick a 4px or 8px scale and stick to it. No random margins.
- Consistent corner radii and one consistent shadow level per surface type.
- Cards should feel like separate objects on a calm background, not boxes packed edge to edge.

Specific things to fix:
- Screen 0: the three category cards are the hero. Make the choice feel obvious and make the card
  contents line up with each other. The intro video block below needs to feel intentional, not tacked on.
- Screen 1: the settings strip at the bottom currently reads as a wall of checkboxes. Give it a
  lighter, more structured treatment.
- Screen 4 (generating): this is the screen users stare at longest. Make it feel calm and credible —
  clear progress, clear stage naming, no visual noise.
- Screen 5 (editor): the toolbar is cramped and the three panels (contents / document / evidence)
  do not feel balanced. Give the document area more authority and make the side panels recede.
- Everywhere: check that nothing overflows its container, no card is left with a big empty bottom,
  and no two adjacent boxes look like they accidentally merged.

CONSTRAINTS — non-negotiable
- Output must remain ONE self-contained .html file. Inline CSS and inline JS only.
- No external fonts, no CDN scripts, no build step. System font stack only.
- Keep every existing feature and every existing element id / class that the JavaScript depends on.
  The JS behaviour (wizard gating, file handling, video duration read, TOC scroll, formatting
  toolbar, flag jumping, autosave indicator, download button feedback) must still work.
- Light theme. Good contrast. Readable at a glance.
- Do not add new features. This is a visual redesign, not a feature pass.

STEP 3 — VERIFY
Open the file in a browser and click through all six screens in at least two categories.
Confirm the wizard still gates correctly, the editor toolbar still formats text, and the
contents sidebar still scrolls to sections. Fix anything that broke.

STEP 4 — REPORT
Tell me, in under 250 words: the Mobbin patterns you used and where, the main visual decisions you
made, and anything you think still needs a designer's eye.
```

---

## 2. Appendix — design direction in more detail

Everything below is context the session can use. You do not need to paste it; just leave this file  
in the folder and point the session at it if it wants to go deeper.

### 2.1 What "good" looks like for this product

The product's promise is **trust**. A student submits this. A supervisor circulates this. So the  
interface should feel:

- **Calm** — no celebration animations, no confetti, no purple gradients
- **Competent** — dense information presented clearly beats big empty illustrations
- **Honest** — the flagged / unverified states must be visible without being alarming

The visual opposite of this product is a flashy AI demo. Avoid that.

### 2.2 Suggested foundation

| Token           | Suggested value                                        | Notes                                                    |
| --------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Page background | `#f7f8fa` – `#f4f5f9`                                  | one neutral, slightly cool grey                          |
| Card surface    | `#ffffff`                                              | the only place white appears                             |
| Border          | `#e4e7ec`                                              | hairline, low contrast                                   |
| Primary text    | `#101828`                                              | near-black                                               |
| Secondary text  | `#475467`                                              |                                                          |
| Muted text      | `#667085`                                              | supporting copy only                                     |
| Accent          | one hue, e.g. `#3538cd` or `#0f766e`                   | used on: primary button, selected state, active TOC item |
| Success         | `#15803d`                                              | verified states                                          |
| Warning         | `#b45309`                                              | flagged / unverified states                              |
| Radius          | 12px cards, 8px controls                               | pick two and stop                                        |
| Shadow          | one subtle level for cards, one for the sticky toolbar | no stacked shadows                                       |

### 2.3 Per-screen priorities

**Screen 0 — Choose category**  
The three cards must align: same icon baseline, same title baseline, same description start,  
same footer note. Alignment is what makes a row of cards look designed. The intro video wants a  
frame — a labelled container, not a floating rectangle.

**Screen 1 — Evidence**  
Two upload zones read as a pair, so they should be identical in construction. The settings strip is  
secondary — make it visibly quieter than the uploads (smaller type, no competing border).

**Screen 2 — Context**  
The textarea is the main event; the upload panel is the alternative. Make that hierarchy obvious —  
"type it" primary, "or upload it" secondary.

**Screen 3 — Template**  
Two options, so the selected one must be unmistakable. The section-mapping table is the most  
"product-y" moment in the whole flow — give it a proper table treatment with clear row separation.

**Screen 4 — Generating**  
Longest dwell time. Needs: one focal element (progress), the current stage name, and one line of  
reassurance. Nothing else competes. Stage rows should show completed / active / pending clearly.

**Screen 5 — Editor**  
Three columns. The document is the product, so it should be the widest and visually dominant;  
both side panels should be quieter — smaller type, less contrast. The toolbar is dense by nature,  
so give it clear grouping separators and make the download buttons read as actions, not labels.

### 2.4 Things to check before calling it done

- No card has a large empty bottom half
- No two adjacent boxes look merged
- Nothing overflows its container at 1280px width
- Every interactive state exists: hover, selected, focus, disabled
- The disabled "Continue" button looks clearly unavailable
- Warning states are recognisable at a glance but not alarming
- All text passes a contrast sanity check on the light background
