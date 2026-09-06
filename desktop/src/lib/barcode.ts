/**
 * Code 128 barcode encoding.
 *
 * WHY HAND-ROLLED RATHER THAN A LIBRARY
 * -------------------------------------
 * Code 128 is a small, fixed, fully specified standard — the symbol set and
 * the checksum have not changed since 1981. A dependency here would be a
 * supply-chain surface and an extra thing to keep current, in exchange for
 * about a hundred lines that can be tested exactly.
 *
 * WHY CODE 128 AND NOT EAN-13
 * ---------------------------
 * EAN-13 needs a purchased GS1 company prefix and is fixed at 13 digits. These
 * are the shop's own internal item codes (300100 …), scanned only by the
 * shop's own tills, so an internal symbology is the correct choice. Code 128
 * also carries letters, which matters because a SKU here is not guaranteed to
 * be numeric.
 *
 * Subset B throughout: it covers the full printable ASCII range, so any SKU
 * the catalogue can hold will encode. Subset C would pack digit pairs more
 * tightly, but a narrower symbol is worth nothing on a garment tag and the
 * switching logic is where bugs live.
 */

/** Width pattern for each Code 128 symbol: six digits of alternating bar/space widths. */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Every character Code 128 subset B can represent: ASCII 32 (space) to 126 (~). */
export function isEncodable(value: string): boolean {
  return value.length > 0 && [...value].every((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
}

/**
 * The bar/space widths for `value`, as module counts.
 *
 * Returns an array where index 0 is a BAR, index 1 a SPACE, and so on — the
 * caller alternates. Throws on unencodable input rather than silently dropping
 * a character, because a barcode that scans as a different SKU is worse than
 * one that does not print.
 */
export function code128Widths(value: string): number[] {
  if (!isEncodable(value)) {
    throw new Error(`Cannot encode "${value}" as Code 128 subset B.`);
  }

  const codes: number[] = [START_B];
  for (const ch of value) {
    // Subset B maps ASCII 32..126 onto symbol values 0..94.
    codes.push(ch.charCodeAt(0) - 32);
  }

  // Modulo-103 weighted checksum. The start symbol has weight 1; each data
  // symbol is weighted by its 1-based position.
  let checksum = START_B;
  for (let i = 1; i < codes.length; i += 1) {
    checksum += codes[i] * i;
  }
  codes.push(checksum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  for (const code of codes) {
    for (const digit of PATTERNS[code]) {
      widths.push(Number(digit));
    }
  }
  return widths;
}

export interface BarcodeSvgOptions {
  /** Pixels per module. 2 is readable on a 38mm tag at 203 dpi. */
  moduleWidth?: number;
  height?: number;
  /** Print the value underneath in monospace. */
  showText?: boolean;
}

/**
 * Render `value` as a self-contained SVG string.
 *
 * SVG rather than canvas because these go to a PRINTER: a canvas bitmap is
 * rasterised at screen resolution and the bars blur into each other at label
 * size, which a scanner then refuses. Vector bars stay crisp at any dpi.
 */
export function code128Svg(value: string, options: BarcodeSvgOptions = {}): string {
  const { moduleWidth = 2, height = 50, showText = true } = options;

  const widths = code128Widths(value);
  const totalModules = widths.reduce((sum, w) => sum + w, 0);
  const width = totalModules * moduleWidth;
  const textHeight = showText ? 14 : 0;

  let x = 0;
  let bars = '';
  widths.forEach((modules, index) => {
    const w = modules * moduleWidth;
    // Even indices are bars, odd are spaces.
    if (index % 2 === 0) {
      bars += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
    }
    x += w;
  });

  const text = showText
    ? `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" ` +
      `font-family="monospace" font-size="11" fill="#000">${escapeXml(value)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" ` +
    `height="${height + textHeight}" viewBox="0 0 ${width} ${height + textHeight}">` +
    `${bars}${text}</svg>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
