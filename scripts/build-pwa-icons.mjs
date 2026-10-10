// Mechanical raster export of the existing Chengzi SVG mark.
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import sharp from "sharp";
const root=process.cwd(),svg=await readFile(join(root,"public","favicon.svg"));
for(const size of [192,512])await sharp(svg).resize(size,size).png().toFile(join(root,"public",`icon-${size}.png`));
console.log("Exported Chengzi PWA icons at 192 and 512 pixels.");

