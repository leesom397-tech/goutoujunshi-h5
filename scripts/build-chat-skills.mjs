// Build reviewed verbatim paragraphs from pinned upstream skills. No network,
// execution of upstream tools, or automatic updates happen during a build.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const lock=JSON.parse(readFileSync(new URL('third-party/chat-skills/manifest.json',root),'utf8'));
const modules=lock.skills.map(skill=>{
 const source=readFileSync(new URL('third-party/chat-skills/'+skill.directory+'/SKILL.md',root),'utf8');
 const license=readFileSync(new URL('third-party/chat-skills/'+skill.directory+'/LICENSE',root),'utf8');
 if(createHash('sha256').update(source).digest('hex')!==skill.sha256)throw Error('Reviewed skill changed: '+skill.id);
 if(!license.includes('MIT License')||!license.includes('Permission is hereby granted'))throw Error('Missing skill license: '+skill.id);
 const paragraphs=source.replace(/\r\n/g,'\n').split(/\n\s*\n/);
 const excerpts=skill.paragraphs.map(prefix=>{
  const matches=paragraphs.filter(paragraph=>paragraph.startsWith(prefix));
  if(matches.length!==1)throw Error('Skill paragraph missing or ambiguous: '+skill.id+' '+prefix);
  return matches[0];
 });
 return {id:skill.id,revision:skill.revision,source:skill.source,content:excerpts.join('\n\n')};
});
if(modules.reduce((sum,module)=>sum+module.content.length,0)>2300)throw Error('Chat skills exceed the reviewed prompt budget');
writeFileSync(new URL('lib/chat-skills.generated.json',root),JSON.stringify(modules),'utf8');
console.log('Bundled '+modules.length+' pinned chat skills ('+modules.reduce((sum,module)=>sum+module.content.length,0)+' characters).');
