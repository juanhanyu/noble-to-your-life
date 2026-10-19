// Deterministic local retrieval. Does not generate or rewrite scripture.
const groups = [
 ['喝水','口渴','给我水喝','请你给我水喝','水喝','渴了','渴'],['吃饭','吃东西','吃的','吃早饭','食物','饥饿','饿了','饿'],
 ['去哪里','去哪','哪里去','往哪里去','到哪里去','往何处','何往'],['叫什么名字','叫什么','你的名字','你的名','名叫什么','你名叫什么','何名'],
 ['手里拿的是什么','拿什么','手里是什么','手中','手里'],['不知道自己在做什么','不懂自己在干嘛','不知道自己所做的','不晓得','不知道'],
 ['别怕','害怕','恐惧','惧怕','不要怕','胆怯'],['累了','好累','疲惫','劳苦','困乏','安息','疲乏'],
 ['焦虑','担心','忧虑','愁烦','挂虑'],['伤心','难过','悲伤','忧伤','哀恸','哭泣'],['开心','高兴','快乐','欢喜','喜乐'],
 ['闭嘴','别说了','住口','静默','不作声'],['走开','离开我','离我远点','退去','离开'],['不干了','放弃','灰心','丧志'],
 ['睡觉','睡了','睡眠','安睡'],['朋友','友谊','朋友相爱'],['原谅','饶恕','宽恕'],['报复','报仇','伸冤'],
 ['喜欢你','我爱你','爱情','相爱','爱'],['谢谢','感谢','感恩'],['不要生气','生气','发怒','怒气'],['骗人','谎言','说谎','欺骗'],
 ['没钱','贫穷','穷人','贫乏'],['有钱','富足','财富','财宝'],['努力','勤劳','殷勤'],['懒惰','偷懒','懒人'],
 ['孤独','寂寞','独自','孤单'],['帮助','帮忙','扶持'],['你说吧','请说','说吧'],['你也想去吗','你们也要去吗','也要去吗'],
 ['不给你','不把','不给'],['明天','未来','将来'],['公平','公义','公正'],['聪明','智慧','明哲'],['傻瓜','笨蛋','愚昧','愚顽']
];
let conversion={};
function setConversion(map){conversion=map;}
function normalize(s){return [...s.toLowerCase().normalize('NFKC')].map(c=>conversion[c]||c).join('').replace(/甚么/g,'什么').replace(/[^\p{L}\p{N}]/gu,'');}
function terms(s){const a=[...s],r=new Set(a);for(let i=0;i<a.length-1;i++)r.add(a[i]+a[i+1]);return r;}
const stops=new Set([...'的了你我他她们也是在有这那吗么要不一就来去是说']);
function weight(t){return t.length>1?2.5:stops.has(t)?0.12:1;}
function fragments(text){
 const result=new Set();const add=s=>{s=s.replace(/^[\s「」“”"『』]+|[\s「」“”"『』]+$/g,'').trim();if(normalize(s).length>=2)result.add(s);};
 for(const p of text.split(/[：:「」“”"『』]/)){add(p);const a=p.match(/[^，,。！？!?；;、]+[，,。！？!?；;、]?/g)||[];a.forEach(add);for(let i=0;i<a.length-1;i++)add(a[i]+a[i+1]);}
 add(text);return [...result];
}
function prepare(data){const records=data.verses.map(([book,chapter,verse,text])=>({book,chapter,verse,text,norm:normalize(text)}));const index=new Map();records.forEach((r,i)=>{for(const t of terms(r.norm)){if(!index.has(t))index.set(t,[]);index.get(t).push(i);}});return {...data,records,index};}
function compare(q,qt,s){
 if(!s)return 0;if(q===s)return 4;
 if(s.includes(q))return 2.3+q.length/s.length;
 const st=terms(s);let overlap=0,qw=0,sw=0;
 for(const t of qt){const w=weight(t);qw+=w;if(st.has(t))overlap+=w;}
 for(const t of st)sw+=weight(t);
 return 0.8*(2*overlap/(qw+sw||1))+0.2*(overlap/(qw||1));
}
function search(datasets,query,{mode='smart',limit=24}={}){
 const q=normalize(query);if(!q)return [];
 const variants=[q];if(mode==='smart')for(const g of groups){const ng=g.map(normalize);const hits=ng.filter(s=>q.includes(s));for(const hit of hits)for(const synonym of ng){variants.push(q.replace(hit,synonym));if(hit.length/q.length>=0.55)variants.push(synonym);}}
 const qs=[...new Set(variants)].map(q=>[q,terms(q)]);
 const ref=query.match(/^(.+?)\s*(\d+)\s*[:：]\s*(\d+)\s*$/);
 const out=[];
 for(const d of datasets){
 const candidates=new Map();for(let qi=0;qi<qs.length;qi++)for(const t of qs[qi][1]){const w=weight(t)*(qi===0?1:0.15);for(const idx of d.index.get(t)||[])candidates.set(idx,(candidates.get(idx)||0)+w);}
 const shortlist=ref?d.records:[...candidates].map(([i,s])=>[i,s/Math.sqrt(d.records[i].norm.length||1)+(d.records[i].norm.includes(q)?100:0)]).sort((a,b)=>b[1]-a[1]).slice(0,450).map(([i])=>d.records[i]);
 for(const r of shortlist){
  const referenceMatch=ref&&normalize(d.books[r.book-1])===normalize(ref[1])&&r.chapter===+ref[2]&&r.verse===+ref[3];
  if(ref&&!referenceMatch)continue;
  if(mode==='exact'&&!r.norm.includes(q)&&!referenceMatch)continue;
  let best=0,part=r.text,exact=false;
  for(const text of fragments(r.text)){const p={text,norm:normalize(text)};
   let score=compare(q,qs[0][1],p.norm);const isExact=p.norm.includes(q);
   if(mode==='smart')for(let i=1;i<qs.length;i++){const related=compare(qs[i][0],qs[i][1],p.norm);const lengthWeight=Math.min(1,qs[i][0].length/q.length);score=Math.max(score,0.4*compare(q,qs[0][1],p.norm)+related*(0.28+0.2*lengthWeight));}
   if(score>best){best=score;part=p.text;exact=isExact;}
  }
  if(referenceMatch){best=10;part=r.text;exact=true;}
  if(best>0.24)out.push({...r,parts:undefined,norm:undefined,snippet:part,score:best,exact,version:d.id,versionName:d.name,bookName:d.books[r.book-1]});
 }
 }
 return out.sort((a,b)=>b.score-a.score||a.snippet.length-b.snippet.length).slice(0,limit);
}
function validateImport(data){
 if(!data||typeof data.name!=='string'||!data.name.trim()||data.name.length>100)throw Error('请提供 1–100 字的译本名称 name。');
 if(!Array.isArray(data.books)||!data.books.length||data.books.length>100||data.books.some(b=>typeof b!=='string'||!b.trim()||b.length>100))throw Error('books 应为书卷名称数组（最多 100 卷）。');
 if(!Array.isArray(data.verses)||!data.verses.length||data.verses.length>60000)throw Error('verses 应包含 1–60,000 条经文。');
 const seen=new Set();for(const r of data.verses){if(!Array.isArray(r)||r.length!==4||!Number.isInteger(r[0])||r[0]<1||r[0]>data.books.length||!Number.isInteger(r[1])||r[1]<1||!Number.isInteger(r[2])||r[2]<1||typeof r[3]!=='string'||!r[3].trim()||r[3].length>10000)throw Error('每条经文须为 [书卷序号, 章, 节, 原文]，序号从 1 开始。');const key=r.slice(0,3).join(':');if(seen.has(key))throw Error('导入内容有重复章节目，请先去重。');seen.add(key);}
 return {id:data.id,name:data.name.trim(),language:typeof data.language==='string'?data.language.slice(0,100):'自定义译本',books:data.books,verses:data.verses};
}
function formatQuote(r,{whole=false,template='“{text}”（{book} {chapter}:{verse}）',withVersion=false}={}){const fields={text:whole?r.text:r.snippet,book:r.bookName,chapter:r.chapter,verse:r.verse,version:r.versionName};return template.replace(/\{(text|book|chapter|verse|version)\}/g,(_,k)=>fields[k])+(withVersion&&!template.includes('{version}')?`〔${r.versionName}〕`:'');}

module.exports={prepare,search,setConversion,validateImport,formatQuote};
