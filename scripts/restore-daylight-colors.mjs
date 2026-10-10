// Restore only color tokens in matching original declarations; retain current
// layout, copy, routes, assets and all declarations added after the saved theme.
import fs from 'node:fs';
import postcss from 'postcss';
const originals=JSON.parse(fs.readFileSync('outputs/warm-palette/original-root-styles.json','utf8'));
const excluded=new Set(['app/workspace/workspace.css','components/workspace-dashboard.css','components/glass-scene.css']);
const colors=/#(?:[a-f\d]{8}|[a-f\d]{6}|[a-f\d]{4}|[a-f\d]{3})\b|rgba?\([^)]*\)/gi;
const output='outputs/glass-restoration';fs.mkdirSync(output,{recursive:true});
function declarations(css){const map=new Map();const counts=new Map();postcss.parse(css).walkDecls(d=>{let parents=[];for(let p=d.parent;p&&p.type!=='root';p=p.parent)parents.unshift(p.type==='rule'?p.selector:'@'+p.name+' '+p.params);const stem=parents.join(' | ')+' | '+d.prop;const index=counts.get(stem)||0;counts.set(stem,index+1);map.set(stem+' | '+index,d);});return map;}
const before={},audit=[];
for(const [file,original]of Object.entries(originals)){
 if(excluded.has(file))continue;
 const current=fs.readFileSync(file,'utf8');before[file]=current;const old=declarations(original);const root=postcss.parse(current);const counts=new Map();let count=0;
 root.walkDecls(d=>{let parents=[];for(let p=d.parent;p&&p.type!=='root';p=p.parent)parents.unshift(p.type==='rule'?p.selector:'@'+p.name+' '+p.params);const stem=parents.join(' | ')+' | '+d.prop;const index=counts.get(stem)||0;counts.set(stem,index+1);const saved=old.get(stem+' | '+index);if(!saved||/mask/.test(d.prop))return;const target=saved.value.match(colors),source=d.value.match(colors);if(!target||!source||source.length!==target.length)return;let i=0;const next=d.value.replace(colors,()=>target[i++]);if(next!==d.value){d.value=next;count++;}});
 fs.writeFileSync(file,root.toString());audit.push({file,restoredColorDeclarations:count});
}
fs.writeFileSync(output+'/before-root-colors.json',JSON.stringify(before));fs.writeFileSync(output+'/color-restore-audit.json',JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));
