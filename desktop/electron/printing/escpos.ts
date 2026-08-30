/**
 * ESC/POS byte encoding.
 *
 * Kept separate from the layout (receipt-formatter.ts) on purpose: the layout
 * is text that a human can read in a test failure, and this turns that text
 * into the control codes a thermal printer understands. Mixing the two would
 * mean debugging column alignment by staring at hex.
 *
 * The command set here is the small, near-universal subset supported by
 * essentially every ESC/POS thermal printer (Epson TM series and the many
 * clones sold in India). Nothing model-specific is used, because no physical
 * printer has been available to verify vendor extensions against.
 */

/** Control sequences, named so call sites read as intent rather than hex. */
export const ESC = 0x1b;
export const GS = 0x1d;

export const CMD = {
  /** ESC @ — reset to a known state. Always sent first: a printer may still
   *  be in bold or double-height from whatever printed before us. */
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0],
  ALIGN_CENTRE: [ESC, 0x61, 1],
  BOLD_ON: [ESC, 0x45, 1],
  BOLD_OFF: [ESC, 0x45, 0],
  DOUBLE_HEIGHT_ON: [GS, 0x21, 0x01],
  DOUBLE_SIZE_OFF: [GS, 0x21, 0x00],
  /** GS V 1 — partial cut, leaving a small tab so the receipt does not fall
   *  on the floor. Full cut is deliberately not used. */
  CUT: [GS, 0x56, 0x01],
  /** ESC p — fire the cash drawer kick-out on pin 2. Only sent when asked. */
  DRAWER_KICK: [ESC, 0x70, 0x00, 0x19, 0xfa],
} as const;

export interface EncodeOptions {
  /** Blank lines fed before the cut, so the tear-off is below the text. */
  feedLines?: number;
  cut?: boolean;
  /** Opens the cash drawer as part of the same job. */
  openDrawer?: boolean;
  /** Emphasise the first line (the shop name). */
  boldHeader?: boolean;
}

/**
 * Encode receipt lines into an ESC/POS byte stream.
 *
 * Text is encoded as latin1 rather than utf8. Thermal printers use single-byte
 * code pages; sending multi-byte UTF-8 produces garbage on paper. Characters
 * outside the range are transliterated by `toPrintableAscii` BEFORE they get
 * here, so the rupee sign becomes "Rs." rather than a random glyph.
 */
export function encodeReceipt(lines: string[], options: EncodeOptions = {}): Buffer {
  const parts: number[] = [];
  const push = (bytes: readonly number[]): void => {
    parts.push(...bytes);
  };
  const text = (value: string): void => {
    parts.push(...Buffer.from(toPrintableAscii(value), 'latin1'));
    parts.push(0x0a);
  };

  push(CMD.INIT);

  lines.forEach((line, index) => {
    if (index === 0 && options.boldHeader) {
      push(CMD.BOLD_ON);
      text(line);
      push(CMD.BOLD_OFF);
      return;
    }
    text(line);
  });

  for (let i = 0; i < (options.feedLines ?? 4); i++) parts.push(0x0a);

  if (options.openDrawer) push(CMD.DRAWER_KICK);
  if (options.cut !== false) push(CMD.CUT);

  return Buffer.from(parts);
}

/**
 * Replace characters a single-byte thermal printer cannot render.
 *
 * The rupee sign is the one that matters: U+20B9 is absent from every common
 * thermal code page, and sending it prints a stray symbol next to every
 * amount on the customer's copy. "Rs." is unambiguous and always prints.
 */
export function toPrintableAscii(value: string): string {
  return value
    .replace(/₹/g, 'Rs.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Anything still outside printable ASCII becomes '?' rather than a random
    // glyph — a visible placeholder beats silent corruption.
    .replace(/[^\x20-\x7E\n]/g, '?');
}

/** Just the drawer pulse, for a printer that also drives the cash drawer. */
export function encodeDrawerKick(): Buffer {
  return Buffer.from([...CMD.INIT, ...CMD.DRAWER_KICK]);
}
