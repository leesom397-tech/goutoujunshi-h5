// The web keeps native SVG. Only native WeChat images are rasterized for iOS parity.
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

await mkdir('.tmp',{recursive:true});
await mkdir('miniapp/assets/page-scenes',{recursive:true});
await mkdir('outputs/page-scenes',{recursive:true});
const modulePath=resolve('.tmp/native-page-scenes.mjs');
await build({entryPoints:['components/PageIllustration.tsx'],outfile:modulePath,bundle:true,platform:'node',format:'esm',external:['react','react/jsx-runtime','lucide-react'],loader:{'.css':'empty'},logLevel:'silent'});
const {PageIllustration}=await import(pathToFileURL(modulePath).href+'?v='+Date.now());
const palette={'--ci-ink':'#547b8f','--ci-accent':'#237a98','--ci-gold':'#ba9b76','--ci-edge':'#bad7e5','--ci-faint':'#d4e8f2','--ci-soft':'#e4f3fa'};
const variants=['analysis','social','chat','voice','report','archive','self','account'];
let artworkBytes=0;
for(const variant of variants){
 const markup=renderToStaticMarkup(createElement(PageIllustration,{variant}));
 let svg=markup.match(/<svg[\s\S]*<\/svg>/)?.[0];
 if(!svg)throw Error('Missing SVG: '+variant);
 svg=svg.replace(/var\((--[a-z-]+)\)/g,(_all,key)=>palette[key]||'#547b8f').replace('<svg ','<svg width="420" height="300" style="color:#547b8f" ');
 svg=svg.replace(/(<svg[^>]+>)/,'$1<style>.cz-illustration-rule{stroke:#899da7;stroke-width:2.4;stroke-linecap:round;opacity:.62}</style>');
 await writeFile(`outputs/page-scenes/${variant}.svg`,svg);
 const buffer=await sharp(Buffer.from(svg)).png({palette:true,colours:128,effort:10,dither:.6}).toBuffer();
 artworkBytes+=buffer.length;
 await writeFile(`miniapp/assets/page-scenes/${variant}.png`,buffer);
}
const root=resolve('miniapp'), config=JSON.parse(await readFile('miniapp/project.config.json','utf8'));
const ignored=new Set(config.packOptions.ignore.filter(item=>item.type==='file').map(item=>item.value));
async function bytes(directory){let total=0;for(const item of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,item.name);if(item.isDirectory())total+=await bytes(path);else if(!ignored.has(relative(root,path).replaceAll('\\','/')))total+=(await stat(path)).size;}return total;}
const includedSourceBytes=await bytes(root);
if(includedSourceBytes>=2*1024*1024)throw Error('Native source package exceeds 2 MiB budget: '+includedSourceBytes);
console.log(JSON.stringify({variants,artworkBytes,includedSourceBytes,transparent:true,webUsesNativeSvg:true}));
