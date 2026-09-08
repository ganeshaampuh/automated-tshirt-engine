import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SizeClass } from "../src/engine/types";

const OUT_DIR = path.join(__dirname, "..", "public", "mockups");

async function make(id: string, sizeClasses: SizeClass[], W: number, H: number, pxPerCm: number) {
  // simple t-shirt silhouette: body rect + sleeves, light grey outline on white, transparent outside
  const bodyW = Math.round(W * 0.56), bodyX = Math.round((W - bodyW) / 2), bodyY = Math.round(H * 0.18);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <path d="M${bodyX},${bodyY} L${bodyX - W * 0.14},${bodyY + H * 0.14} L${bodyX - W * 0.08},${bodyY + H * 0.24} L${bodyX},${bodyY + H * 0.20}
      L${bodyX},${H * 0.95} L${bodyX + bodyW},${H * 0.95} L${bodyX + bodyW},${bodyY + H * 0.20} L${bodyX + bodyW + W * 0.08},${bodyY + H * 0.24}
      L${bodyX + bodyW + W * 0.14},${bodyY + H * 0.14} L${bodyX + bodyW},${bodyY} Q${W / 2},${bodyY + H * 0.06} ${bodyX},${bodyY} Z"
      fill="#ffffff" stroke="#c8c8c8" stroke-width="6"/></svg>`;
  mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, `${id}.png`));
  writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify({
    id, sizeClasses, image: `${id}.png`, pxPerCm: Number(pxPerCm.toFixed(6)), width: W, height: H,
    chestAnchor: { x: W / 2, y: Math.round(bodyY + H * 0.10) },
  }, null, 2) + "\n");
}

// adult shirt ~ 56 cm wide body → bodyW px / 56 cm ; kids ~ 36 cm
make("adult-flat", ["adult"], 2400, 2600, (2400 * 0.56) / 56)
  .then(() => make("kids-flat", ["kids-0-1", "kids-1-9"], 2400, 2600, (2400 * 0.56) / 36))
  .then(() => console.log("ok"))
  .catch((err) => { console.error(err); process.exitCode = 1; });
