const engine=require('./engine.js');
let dataset=null;
worker.onMessage(m=>{try{
 if(m.type==='init'){engine.setConversion(m.conversion);dataset=engine.prepare(m.data);worker.postMessage({type:'ready',count:dataset.records.length});}
 if(m.type==='search'){if(!dataset)throw Error('文字库未准备好');worker.postMessage({type:'results',request:m.request,results:engine.search([dataset],m.query,{mode:m.mode,limit:24})});}
}catch(e){worker.postMessage({type:'error',message:e.message,request:m.request});}});
