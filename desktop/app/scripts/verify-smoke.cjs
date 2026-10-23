'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const asar=require('@electron/asar');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const required=['sandbox','nodeDisabled','contextIsolation','backgroundProgress','homeLocal','hostAvailable','nodeUnavailable','apiUpload','routes','returned','nativeNavigation','nativeReturn','runtime'];
function verify(resources,receiptFile,sourceRoot){
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  const version=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8')).version;
  if(receipt.version!==version||receipt.ok!==true||receipt.userDataUsed!==false||receipt.networkRequestsMocked!==true||!Array.isArray(receipt.errors)||receipt.errors.length||required.some(name=>receipt.checks?.[name]!==true))throw Error('Installed smoke receipt is incomplete, failed or from a different version.');
  const archive=path.join(resources,'app.asar');
  const read=name=>asar.extractFile(archive,name.split('/').join(path.sep));
  const main=read('main.cjs'),frontend=read('frontend-dist/asset-integrity.json'),service=fs.readFileSync(path.join(resources,'service-manifest.json'));
  if(hash(main)!==receipt.inputs?.main||hash(frontend)!==receipt.inputs?.frontend||hash(service)!==receipt.inputs?.service)throw Error('Smoke did not exercise these exact installed resources.');
  if(hash(fs.readFileSync(path.join(__dirname,'../main.cjs')))!==hash(main))throw Error('Main process source changed after packaging.');
  const sources=JSON.parse(read('frontend-dist/source-integrity.json'));
  if(sources.schemaVersion!==1||!sources.files||!Object.keys(sources.files).length)throw Error('Missing frontend source fingerprints.');
  for(const [name,expected] of Object.entries(sources.files)){
    const file=path.resolve(sourceRoot,name),relative=path.relative(sourceRoot,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)||hash(fs.readFileSync(file))!==expected)throw Error('Frontend source changed after build: '+name);
  }
  const assets=JSON.parse(frontend).assets;
  for(const asset of assets)if(hash(read('frontend-dist/'+asset.path))!==asset.sha256)throw Error('Installed frontend asset changed: '+asset.path);
  return {ok:true,version,checks:required.length,sourceFiles:Object.keys(sources.files).length,assets:assets.length,inputs:receipt.inputs};
}
module.exports={verify};
if(require.main===module){const [resources,receipt,sourceRoot]=process.argv.slice(2);if(!resources||!receipt||!sourceRoot)throw Error('resources, receipt and source root required');console.log(JSON.stringify(verify(path.resolve(resources),path.resolve(receipt),path.resolve(sourceRoot))));}
