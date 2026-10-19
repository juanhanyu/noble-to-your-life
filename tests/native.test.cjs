const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../miniprogram');
const engine=require('../miniprogram/workers/engine.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifest=read('manifest.json');
function data(id){const chunks=[0,1,2].map(i=>require(path.join(root,'library/'+id+i+'/data.js')));return {...chunks[0],verses:chunks.flatMap(c=>c.verses)};}
test('release packages preserve all five datasets and remain within size limits',()=>{
 const config=read('app.json');assert.equal(config.subPackages.length,15);
 for(const m of manifest){const d=data(m.id);engine.validateImport(d);assert.equal(d.verses.length,m.count);for(let i=0;i<3;i++){const dir=path.join(root,'library/'+m.id+i);const size=fs.readdirSync(dir).reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);assert.ok(size<2*1024*1024,m.id+i);}}
});
test('native worker initializes, searches real photo references, and preserves excerpts',()=>{
 let receive;const messages=[];
 const worker={onMessage(fn){receive=fn;},postMessage(msg){messages.push(msg);}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'workers/search.js'),'utf8'),{worker,require:()=>engine});
 receive({type:'init',conversion:read('normalize.json'),data:data('cuvs')});assert.equal(messages.pop().count,31103);
 for(const [query,b,c,v] of [['可以给我水喝吗',43,4,7],['你们这里有什么吃的吗',42,24,41],['你也想去吗',43,6,67],['你手里拿的是什么',2,4,2]]){receive({type:'search',request:7,query,mode:'smart'});const msg=messages.pop();assert.equal(msg.request,7);assert.ok(msg.results.slice(0,5).some(r=>r.book===b&&r.chapter===c&&r.verse===v),query);for(const r of msg.results)assert.ok(r.text.includes(r.snippet));}
});
test('native page loads split files, selects a result, copies and persists favorites',async()=>{
 let definition,workerReceive,stored,clipboard;
 const wx={getStorageSync:()=>[],setStorageSync:(k,v)=>stored=v,showToast:()=>{},setClipboardData:({data})=>clipboard=data,loadSubpackage:({success})=>success(),getFileSystemManager:()=>({readFile:({filePath,success})=>success({data:fs.readFileSync(path.join(root,filePath),'utf8')})}),createWorker:()=>({terminate(){},onMessage(fn){workerReceive=fn;},postMessage(m){if(m.type==='init')workerReceive({type:'ready',count:m.data.verses.length});else workerReceive({type:'results',request:m.request,results:engine.search([engine.prepare(data('cuvs'))],m.query)});}})};
 const nativeRequire=p=>p==='../../utils/library.js'?id=>Promise.resolve([0,1,2].map(i=>require(path.join(root,'library/'+id+i+'/data.js')))):require(path.resolve(root,'pages/index',p));
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/index/index.js'),'utf8'),{Page:d=>definition=d,wx,require:nativeRequire,decodeURIComponent,encodeURIComponent});
 const page={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};
 page.onLoad({});await new Promise(r=>setTimeout(r,0));assert.equal(page.data.count,31103);assert.equal(page.data.ready,true);
 page.setData({query:'约翰福音 4:7'});page.search();assert.equal(page.data.results.length,1);assert.ok(page.data.preview.includes('约翰福音 4:7'));
 page.copy();assert.equal(clipboard,page.data.preview);page.favorite();assert.equal(stored.length,1);page.favorite();assert.equal(stored.length,0);page.onUnload();
});
