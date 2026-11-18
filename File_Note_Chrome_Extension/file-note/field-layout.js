// Text layout for PDF form fields, used when the saved PDF draws what was typed.
// pdf-lib breaks lines only at spaces, so Japanese (no spaces) ran off the field, and
// for fields with automatic font size it ignores the width, so the text came out huge.
// Here lines break between any two characters (at spaces for Latin words), and an
// automatic size is the largest one up to 12 pt that fits the field.

const MAX_AUTO_SIZE = 12;
const MIN_SIZE = 4;
// Wide scripts that may break between any two characters.
const CJK = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯\u{1f000}-\u{1faff}\u{20000}-\u{3ffff}]/u;
// Characters that must not start a line (closing brackets, Japanese punctuation, small kana).
const NO_LINE_START = /[、。，．,.)）」』】〕〉》］｝!！?？:：;；ー…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞヽヾ]/;

// Line height pdf-lib uses for multi-line fields.
export const lineHeightAt = (font, size) => font.heightAtSize(size) * 1.2;

export function wrapText(text, maxWidth, widthOf) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (!line || widthOf(line + ch) <= maxWidth) {
        line += ch;
        continue;
      }
      if (/\s/.test(ch)) {
        lines.push(line);
        line = '';
        continue;
      }
      const chars = [...line],
        last = chars.at(-1);
      const space = line.lastIndexOf(' ');
      if (!CJK.test(ch) && !CJK.test(last) && space > 0) {
        // A Latin word moves to the next line whole.
        lines.push(line.slice(0, space));
        line = line.slice(space + 1) + ch;
      } else if (NO_LINE_START.test(ch) && chars.length > 1) {
        // Punctuation takes the previous character along, instead of starting a line.
        lines.push(chars.slice(0, -1).join(''));
        line = last + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Returns the text with line breaks where they belong, and the font size to draw it at.
// fontSize 0 means the field asks for an automatic size.
export function layoutFieldText({ text, font, width, height, multiline, fontSize, autoSingleSize }) {
  const widthOf = (size) => (value) => font.widthOfTextAtSize(value, size);
  if (multiline) {
    const fits = (size) => wrapText(text, width, widthOf(size)).length * lineHeightAt(font, size) <= height;
    let size = fontSize;
    if (!size) {
      size = MAX_AUTO_SIZE;
      while (size > MIN_SIZE && !fits(size)) size -= 0.5;
    }
    return { text: wrapText(text, width, widthOf(size)).join('\n'), fontSize: size };
  }
  // One line: an automatic size also shrinks so that the whole text fits the width, as in Acrobat.
  let size = fontSize || autoSingleSize;
  if (!fontSize) {
    const full = font.widthOfTextAtSize(text, 1);
    if (full * size > width) size = Math.max(MIN_SIZE, Math.floor((width / full) * 10) / 10);
  }
  return { text, fontSize: size };
}

export const sizeIn = (da) => {
  const match = /\/[^\s/]+\s+(\d*\.?\d+)\s+Tf/.exec(da || '');
  return match ? Number(match[1]) : undefined;
};

// Appearance provider for pdf-lib's PDFTextField.updateAppearances: lays the text out as
// above and lets pdf-lib's own provider draw it (colours, border, rotation stay the same).
export function textFieldAppearance(field, widget, font) {
  const { defaultTextFieldAppearanceProvider: draw, layoutSinglelineText, TextAlignment } = globalThis.PDFLib;
  const text = field.getText() ?? '';
  if (field.isCombed() || !text) return draw(field, widget, font);
  const widgetSize = sizeIn(widget.getDefaultAppearance()),
    fieldSize = sizeIn(field.acroField.getDefaultAppearance());
  const fontSize = widgetSize ?? fieldSize ?? 0;
  const rect = widget.getRectangle(),
    rotation = widget.getAppearanceCharacteristics()?.getRotation() ?? 0,
    swap = Math.abs(rotation % 180) === 90;
  const inset = 2 * ((widget.getBorderStyle()?.getWidth() ?? 0) + 1);
  const width = (swap ? rect.height : rect.width) - inset,
    height = (swap ? rect.width : rect.height) - inset;
  if (width <= 0 || height <= 0) return draw(field, widget, font);
  const multiline = field.isMultiline();
  const autoSingleSize =
    !multiline && !fontSize
      ? layoutSinglelineText(text, { alignment: TextAlignment.Left, fontSize: 0, font, bounds: { x: 0, y: 0, width, height } }).fontSize
      : undefined;
  const laid = layoutFieldText({ text, font, width: width - 0.5, height, multiline, fontSize, autoSingleSize });
  // pdf-lib reads the size from the widget's /DA; it rewrites /DA with its own font name afterwards.
  if (laid.fontSize !== widgetSize) {
    const da = widget.getDefaultAppearance() ?? field.acroField.getDefaultAppearance() ?? '0 g';
    widget.setDefaultAppearance(
      widgetSize === undefined ? `/F1 ${laid.fontSize} Tf ${da}` : da.replace(/(\/[^\s/]+\s+)(\d*\.?\d+)(\s+Tf)/, `$1${laid.fontSize}$3`),
    );
  }
  const shown = Object.create(field, { getText: { value: () => laid.text } });
  return draw(shown, widget, font);
}
