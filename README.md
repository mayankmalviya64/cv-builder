# CV Builder

Build a one-page A4 CV where **every bullet fills exactly one line, to the brim**.

**Live:** https://mayankmalviya64.github.io/cv-builder/

## What it does

- **Live brim meter on every bullet.** Each bullet is measured in EB Garamond 9.75pt against the real width of its column:
  | Section style | Line capacity |
  |---|---|
  | Experience / Projects (category column) | 449.25pt |
  | POR / Awards (category + year column) | 419.25pt |

  A bullet scores as **at the brim** when it fills 98–100% of its line. Underfilled bullets show how many px or characters to add. Bullets that spill onto a 2nd line show how much to trim and flag orphan words.
- **One-click micro-tweaks**, e.g. "and" → "&" or "Cr" → "Crore", each showing the fill % it would give.
- **Live A4 preview** in the institute CV layout, with colour highlights. Click a bullet in the preview to jump to it in the editor.
- **Page-fit check:** warns, and draws a red line, when content runs past one A4 page.
- **Download PDF** through the browser's print dialog ("Save as PDF").
- **Autosave** in your browser, plus **Export/Import** as a `.json` file.

## Writing tips inside the editor

- Wrap words in `**double stars**` to make them **bold**, or select the words and press **Ctrl/⌘+B**.
- **Enter** adds a new bullet below. **Backspace** in an empty bullet deletes it.

## How the measuring works

`js/measure.js` asks an invisible `<canvas>` how wide each word is in the CV font, wraps the words the way the browser will, and compares the result with the column width. The preview uses the same widths (`css/cv.css`), so what the meter says is what prints.

## Project layout

```
index.html        page shell
css/app.css       builder interface
css/cv.css        the A4 CV page + print rules
js/measure.js     brim engine (font loading, measuring, grading, tweaks)
js/sample.js      starting CV data + blank templates
js/preview.js     CV data → HTML
js/store.js       autosave, import/export, path helpers
js/editor.js      the form on the left
js/app.js         wires everything together
```

No build step: open `index.html` through any static server (e.g. `python3 -m http.server`).

Inspired by the *CV Bullet Line-Density & Brim Checker* by Adarsh Nayan.
