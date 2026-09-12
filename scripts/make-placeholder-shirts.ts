import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SizeClass } from "../src/engine/types";

const OUT_DIR = path.join(__dirname, "..", "public", "mockups");

/**
 * A stand-in tee, drawn rather than photographed. Two files come out of it:
 *
 *   <id>.png        the garment in white, with its seams and collar rib. Flat by design — this is
 *                   what the shirt colour multiplies onto, so any grey baked in here would fight
 *                   the tint.
 *   <id>-shade.png  greyscale light and shadow only, masked to the garment. Multiplied last, over
 *                   the tinted shirt *and* the print, which is what stops the print reading as a
 *                   sticker laid on a flat slab.
 *
 * The body is exactly 0.56·W wide at the armpits: `pxPerCm` is derived from that number against the
 * garment's real width in centimetres, so the proportion is load-bearing and the rest of the
 * silhouette hangs off it. Widen `bodyCm` and every print rendered on this shirt appears smaller,
 * because the same centimetres now buy fewer pixels.
 */
const BODY_FRACTION = 0.56;

function geometry(W: number, H: number) {
  const cx = W / 2;
  return {
    cx,
    neckHalf: 0.095 * W,
    shoulderHalf: 0.295 * W,
    sleeveHalf: 0.425 * W,
    bodyHalf: (BODY_FRACTION / 2) * W,
    neckTopY: 0.196 * H,
    neckBottomY: 0.263 * H,
    shoulderY: 0.208 * H,
    sleeveTopY: 0.31 * H,   // control height that shapes the outer sleeve edge
    sleeveHemOuterY: 0.40 * H,
    sleeveHemInnerY: 0.452 * H,
    armpitY: 0.425 * H,
    hemY: 0.928 * H,
    hemDip: 0.013 * H,
    rib: 0.026 * W,
  };
}

const n = (v: number) => v.toFixed(1);

/** Outline of the garment, clockwise from the left of the neck. */
function outline(W: number, H: number) {
  const g = geometry(W, H);
  const { cx } = g;
  const sleeveIn = g.bodyHalf + 0.028 * W;   // where the sleeve hem meets the underarm seam
  return [
    `M ${n(cx - g.neckHalf)},${n(g.neckTopY)}`,
    // left shoulder, dropping slightly outward
    `C ${n(cx - g.neckHalf - 0.06 * W)},${n(g.neckTopY + 0.003 * H)} ${n(cx - g.shoulderHalf + 0.06 * W)},${n(g.shoulderY - 0.002 * H)} ${n(cx - g.shoulderHalf)},${n(g.shoulderY)}`,
    // sleeve head, then the outer sleeve edge falling to the cuff
    `C ${n(cx - g.shoulderHalf - 0.028 * W)},${n(g.shoulderY + 0.014 * H)} ${n(cx - g.sleeveHalf + 0.004 * W)},${n(g.sleeveTopY)} ${n(cx - g.sleeveHalf)},${n(g.sleeveHemOuterY)}`,
    // cuff
    `L ${n(cx - sleeveIn)},${n(g.sleeveHemInnerY)}`,
    // underarm seam up into the armpit
    `C ${n(cx - sleeveIn + 0.012 * W)},${n(g.sleeveHemInnerY - 0.022 * H)} ${n(cx - g.bodyHalf - 0.004 * W)},${n(g.armpitY + 0.014 * H)} ${n(cx - g.bodyHalf)},${n(g.armpitY)}`,
    // side seam, waisted a touch then flaring to the hem
    `C ${n(cx - g.bodyHalf + 0.008 * W)},${n(g.armpitY + 0.18 * H)} ${n(cx - g.bodyHalf + 0.004 * W)},${n(g.hemY - 0.16 * H)} ${n(cx - g.bodyHalf - 0.006 * W)},${n(g.hemY)}`,
    // hem, dipping in the middle
    `Q ${n(cx)},${n(g.hemY + g.hemDip)} ${n(cx + g.bodyHalf + 0.006 * W)},${n(g.hemY)}`,
    // and back up the mirror image
    `C ${n(cx + g.bodyHalf - 0.004 * W)},${n(g.hemY - 0.16 * H)} ${n(cx + g.bodyHalf - 0.008 * W)},${n(g.armpitY + 0.18 * H)} ${n(cx + g.bodyHalf)},${n(g.armpitY)}`,
    `C ${n(cx + g.bodyHalf + 0.004 * W)},${n(g.armpitY + 0.014 * H)} ${n(cx + sleeveIn - 0.012 * W)},${n(g.sleeveHemInnerY - 0.022 * H)} ${n(cx + sleeveIn)},${n(g.sleeveHemInnerY)}`,
    `L ${n(cx + g.sleeveHalf)},${n(g.sleeveHemOuterY)}`,
    `C ${n(cx + g.sleeveHalf - 0.004 * W)},${n(g.sleeveTopY)} ${n(cx + g.shoulderHalf + 0.028 * W)},${n(g.shoulderY + 0.014 * H)} ${n(cx + g.shoulderHalf)},${n(g.shoulderY)}`,
    `C ${n(cx + g.shoulderHalf - 0.06 * W)},${n(g.shoulderY - 0.002 * H)} ${n(cx + g.neckHalf + 0.06 * W)},${n(g.neckTopY + 0.003 * H)} ${n(cx + g.neckHalf)},${n(g.neckTopY)}`,
    // neckline
    `C ${n(cx + g.neckHalf)},${n(g.neckBottomY)} ${n(cx - g.neckHalf)},${n(g.neckBottomY)} ${n(cx - g.neckHalf)},${n(g.neckTopY)}`,
    "Z",
  ].join(" ");
}

/** The collar rib: the neckline again, offset outward, closed back on itself. */
function collar(W: number, H: number) {
  const g = geometry(W, H);
  const { cx, rib } = g;
  return [
    `M ${n(cx - g.neckHalf)},${n(g.neckTopY)}`,
    `C ${n(cx - g.neckHalf)},${n(g.neckBottomY)} ${n(cx + g.neckHalf)},${n(g.neckBottomY)} ${n(cx + g.neckHalf)},${n(g.neckTopY)}`,
    `L ${n(cx + g.neckHalf + rib * 0.55)},${n(g.neckTopY + rib * 0.35)}`,
    `C ${n(cx + g.neckHalf + rib * 0.9)},${n(g.neckBottomY + rib)} ${n(cx - g.neckHalf - rib * 0.9)},${n(g.neckBottomY + rib)} ${n(cx - g.neckHalf - rib * 0.55)},${n(g.neckTopY + rib * 0.35)}`,
    "Z",
  ].join(" ");
}

/** Cuff and hem bands, plus the shoulder seams — drawn as strokes, not shapes. */
function seams(W: number, H: number) {
  const g = geometry(W, H);
  const { cx } = g;
  const sleeveIn = g.bodyHalf + 0.028 * W;
  const cuff = 0.022 * H;
  const hemBand = 0.022 * H;
  return [
    // cuff bands, parallel to each sleeve hem
    `M ${n(cx - g.sleeveHalf + 0.012 * W)},${n(g.sleeveHemOuterY - cuff)} L ${n(cx - sleeveIn + 0.008 * W)},${n(g.sleeveHemInnerY - cuff)}`,
    `M ${n(cx + g.sleeveHalf - 0.012 * W)},${n(g.sleeveHemOuterY - cuff)} L ${n(cx + sleeveIn - 0.008 * W)},${n(g.sleeveHemInnerY - cuff)}`,
    // hem band
    `M ${n(cx - g.bodyHalf - 0.004 * W)},${n(g.hemY - hemBand)} Q ${n(cx)},${n(g.hemY + g.hemDip - hemBand)} ${n(cx + g.bodyHalf + 0.004 * W)},${n(g.hemY - hemBand)}`,
    // shoulder seams, collar out to the sleeve head
    `M ${n(cx - g.neckHalf - g.rib * 0.55)},${n(g.neckTopY + g.rib * 0.35)} C ${n(cx - g.neckHalf - 0.06 * W)},${n(g.neckTopY + 0.004 * H)} ${n(cx - g.shoulderHalf + 0.05 * W)},${n(g.shoulderY + 0.002 * H)} ${n(cx - g.shoulderHalf)},${n(g.shoulderY)}`,
    `M ${n(cx + g.neckHalf + g.rib * 0.55)},${n(g.neckTopY + g.rib * 0.35)} C ${n(cx + g.neckHalf + 0.06 * W)},${n(g.neckTopY + 0.004 * H)} ${n(cx + g.shoulderHalf - 0.05 * W)},${n(g.shoulderY + 0.002 * H)} ${n(cx + g.shoulderHalf)},${n(g.shoulderY)}`,
    // armhole seams
    `M ${n(cx - g.shoulderHalf)},${n(g.shoulderY)} C ${n(cx - g.shoulderHalf - 0.01 * W)},${n(g.shoulderY + 0.08 * H)} ${n(cx - g.bodyHalf - 0.02 * W)},${n(g.armpitY - 0.05 * H)} ${n(cx - g.bodyHalf)},${n(g.armpitY)}`,
    `M ${n(cx + g.shoulderHalf)},${n(g.shoulderY)} C ${n(cx + g.shoulderHalf + 0.01 * W)},${n(g.shoulderY + 0.08 * H)} ${n(cx + g.bodyHalf + 0.02 * W)},${n(g.armpitY - 0.05 * H)} ${n(cx + g.bodyHalf)},${n(g.armpitY)}`,
  ];
}

function garmentSvg(W: number, H: number) {
  const stroke = Math.max(4, W * 0.0022);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <path d="${outline(W, H)}" fill="#ffffff" stroke="#cfcfcf" stroke-width="${stroke}" stroke-linejoin="round"/>
    <path d="${collar(W, H)}" fill="#ffffff" stroke="#cfcfcf" stroke-width="${stroke}" stroke-linejoin="round"/>
    <g fill="none" stroke="#d8d8d8" stroke-width="${stroke * 0.8}" stroke-linecap="round">
      ${seams(W, H).map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
  </svg>`;
}

/**
 * Shading, as black at low opacity over white: the result multiplies cleanly. Nothing here goes
 * below roughly 0.72 of full brightness, which keeps the artwork legible once it is shaded too.
 */
function shadeSvg(W: number, H: number) {
  const g = geometry(W, H);
  const { cx } = g;
  const blur = (r: number) => `<filter id="b${Math.round(r)}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${r}"/></filter>`;
  const soft = W * 0.03, wide = W * 0.06;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sides" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#7e7e7e"/><stop offset="10%" stop-color="#bdbdbd"/>
        <stop offset="34%" stop-color="#ffffff"/><stop offset="66%" stop-color="#ffffff"/>
        <stop offset="90%" stop-color="#bdbdbd"/><stop offset="100%" stop-color="#7e7e7e"/>
      </linearGradient>
      <radialGradient id="chest" cx="50%" cy="34%" r="46%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      ${blur(soft)}${blur(wide)}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sides)"/>
    <ellipse cx="${n(cx)}" cy="${n(H * 0.42)}" rx="${n(W * 0.30)}" ry="${n(H * 0.26)}" fill="url(#chest)"/>

    <!-- the garment falls away under the collar and under each sleeve -->
    <g filter="url(#b${Math.round(wide)})">
      <ellipse cx="${n(cx)}" cy="${n(g.neckBottomY + H * 0.012)}" rx="${n(g.neckHalf * 1.5)}" ry="${n(H * 0.035)}" fill="#000" opacity="0.16"/>
      <ellipse cx="${n(cx - g.bodyHalf * 0.92)}" cy="${n(g.armpitY + H * 0.02)}" rx="${n(W * 0.07)}" ry="${n(H * 0.05)}" fill="#000" opacity="0.15"/>
      <ellipse cx="${n(cx + g.bodyHalf * 0.92)}" cy="${n(g.armpitY + H * 0.02)}" rx="${n(W * 0.07)}" ry="${n(H * 0.05)}" fill="#000" opacity="0.15"/>
      <ellipse cx="${n(cx - g.sleeveHalf * 0.82)}" cy="${n(g.sleeveHemOuterY - H * 0.02)}" rx="${n(W * 0.05)}" ry="${n(H * 0.045)}" fill="#000" opacity="0.12"/>
      <ellipse cx="${n(cx + g.sleeveHalf * 0.82)}" cy="${n(g.sleeveHemOuterY - H * 0.02)}" rx="${n(W * 0.05)}" ry="${n(H * 0.045)}" fill="#000" opacity="0.12"/>
    </g>

    <!-- a few slack folds, so the body is not one even sheet -->
    <g filter="url(#b${Math.round(soft)})" fill="#000">
      <path d="M ${n(cx - g.bodyHalf * 0.62)},${n(H * 0.50)} C ${n(cx - g.bodyHalf * 0.50)},${n(H * 0.64)} ${n(cx - g.bodyHalf * 0.66)},${n(H * 0.78)} ${n(cx - g.bodyHalf * 0.52)},${n(g.hemY)} l ${n(W * 0.035)},0 C ${n(cx - g.bodyHalf * 0.42)},${n(H * 0.78)} ${n(cx - g.bodyHalf * 0.34)},${n(H * 0.64)} ${n(cx - g.bodyHalf * 0.46)},${n(H * 0.50)} Z" opacity="0.11"/>
      <path d="M ${n(cx + g.bodyHalf * 0.58)},${n(H * 0.52)} C ${n(cx + g.bodyHalf * 0.70)},${n(H * 0.66)} ${n(cx + g.bodyHalf * 0.56)},${n(H * 0.80)} ${n(cx + g.bodyHalf * 0.66)},${n(g.hemY)} l ${n(W * 0.03)},0 C ${n(cx + g.bodyHalf * 0.80)},${n(H * 0.80)} ${n(cx + g.bodyHalf * 0.86)},${n(H * 0.66)} ${n(cx + g.bodyHalf * 0.72)},${n(H * 0.52)} Z" opacity="0.09"/>
      <path d="M ${n(cx - g.bodyHalf)},${n(g.hemY - H * 0.06)} Q ${n(cx)},${n(g.hemY - H * 0.015)} ${n(cx + g.bodyHalf)},${n(g.hemY - H * 0.06)} L ${n(cx + g.bodyHalf)},${n(H)} L ${n(cx - g.bodyHalf)},${n(H)} Z" opacity="0.12"/>
    </g>
  </svg>`;
}

/**
 * @param bodyCm        width of the real garment across the armpits
 * @param printDropCm   how far below the collar seam the top of the print sits — the anchor is
 *                      derived from it rather than typed in, so it survives a change to the neckline
 */
async function make(id: string, sizeClasses: SizeClass[], W: number, H: number, bodyCm: number, printDropCm: number) {
  const pxPerCm = (W * BODY_FRACTION) / bodyCm;
  mkdirSync(OUT_DIR, { recursive: true });

  const garment = await sharp(Buffer.from(garmentSvg(W, H))).png().toBuffer();
  await sharp(garment).toFile(path.join(OUT_DIR, `${id}.png`));

  // the shading is drawn edge to edge, then clipped to the garment's own alpha
  const shade = await sharp(Buffer.from(shadeSvg(W, H)))
    .ensureAlpha()
    .composite([{ input: garment, blend: "dest-in" }])
    .png()
    .toBuffer();
  await sharp(shade).toFile(path.join(OUT_DIR, `${id}-shade.png`));

  const g = geometry(W, H);
  writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify({
    id, sizeClasses, image: `${id}.png`, shade: `${id}-shade.png`,
    pxPerCm: Number(pxPerCm.toFixed(6)), width: W, height: H,
    chestAnchor: { x: W / 2, y: Math.round(g.neckBottomY + printDropCm * pxPerCm) },
  }, null, 2) + "\n");
}

// An adult tee measures about 52 cm across the body and a kids one about 36 cm. The print starts a
// hand's width below the collar on an adult, proportionally less on a child.
make("adult-flat", ["adult"], 2400, 2600, 52, 7)
  .then(() => make("kids-flat", ["kids-0-1", "kids-1-9"], 2400, 2600, 36, 5))
  .then(() => console.log("ok"))
  .catch((err) => { console.error(err); process.exitCode = 1; });
