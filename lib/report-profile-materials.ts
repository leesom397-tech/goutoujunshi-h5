// @ts-nocheck
// Shared presentation projection; parity covered by test-report-profile-materials.mjs.
// Read-only presentation of saved profile captures. Distinct cover frames remain
// available as variants; similar prose alone is never treated as image identity.
function reportProfileMaterials(report) {
  const rows=Array.isArray(report&&report.profileMaterials)?report.profileMaterials:[];
  const images=Array.isArray(report&&report.mediaEvidence)?report.mediaEvidence:[];
  const groups=new Map();
  for(const row of rows){
    if(!row||!row.libraryId||!row.sourceId||!['moments-cover','profile-signature'].includes(row.materialRole))continue;
    const signature=String(row.text||'').normalize('NFKC').trim().replace(/\s+/g,' ');
    const key=JSON.stringify([row.libraryId,row.materialRole,row.materialRole==='profile-signature'?signature:'covers']);
    const image=images.find(image=>image.libraryId===row.libraryId&&image.sourceId===row.sourceId);
    const ref={libraryId:row.libraryId,sourceId:row.sourceId};
    const item={...row,observation:image&&image.observation||'',sourceRefs:[ref],occurrences:1,variants:[]};
    const group=groups.get(key);
    if(!group){groups.set(key,item);continue;}
    if(group.sourceRefs.some(source=>source.libraryId===ref.libraryId&&source.sourceId===ref.sourceId))continue;
    group.sourceRefs.push(ref);group.occurrences++;
    if(row.materialRole==='moments-cover')group.variants.push(item);
  }
  return [...groups.values()];
}
export {reportProfileMaterials};
