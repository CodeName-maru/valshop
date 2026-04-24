/**
 * PWA 아이콘 생성 스크립트
 *
 * assets/icons/*.svg 소스에서 public/icons/*.png 와 public/favicon.ico 를 생성한다.
 * sharp 를 사용하여 결정론적·최적화된 PNG 를 출력한다.
 *
 * 실행: npm run icons
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
// @ts-ignore - to-ico has no types
import toIco from "to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "assets/icons");
const OUT_ICONS = join(ROOT, "public/icons");
const OUT_PUBLIC = join(ROOT, "public");

mkdirSync(OUT_ICONS, { recursive: true });

const iconSvg = readFileSync(join(ASSETS, "icon.svg"));
const maskableSvg = readFileSync(join(ASSETS, "icon-maskable.svg"));

async function renderPng(svg: Buffer, size: number, outPath: string) {
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(outPath, buf);
  console.log(`  wrote ${outPath} (${buf.length} bytes)`);
}

async function renderFavicon(svg: Buffer, outPath: string) {
  const sizes = [16, 32];
  const pngs = await Promise.all(
    sizes.map((s) =>
      sharp(svg, { density: 384 })
        .resize(s, s)
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );
  const ico = await toIco(pngs);
  writeFileSync(outPath, ico);
  console.log(`  wrote ${outPath} (${ico.length} bytes)`);
}

async function main() {
  console.log("Generating PWA icons...");
  await renderPng(iconSvg, 192, join(OUT_ICONS, "icon-192.png"));
  await renderPng(iconSvg, 512, join(OUT_ICONS, "icon-512.png"));
  await renderPng(maskableSvg, 512, join(OUT_ICONS, "icon-maskable-512.png"));
  await renderFavicon(iconSvg, join(OUT_PUBLIC, "favicon.ico"));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
