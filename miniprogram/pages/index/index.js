const editions=require('../../manifest.js');
const conversion=require('../../normalize.js');
const {formatQuote}=require('../../utils/quote.js');
const loadLibrary=require('../../utils/library.js');
Page({
 data:{showSettings:false,quickExamples:['给我水喝','你说吧','你叫什么名字'],query:'',examples:['可以给我水喝吗','你们这里有什么吃的吗','你也想去吗','你说吧','你叫什么名字','我不给你们草'],editions,editionIndex:0,mode:'smart',loading:false,ready:false,status:'正在打开文字库…',results:[],selected:null,preview:'',whole:false,withVersion:false,template:'“{text}”（{book} {chapter}:{verse}）',favorites:[],showFavorites:false,count:0},
 onLoad(options){this.request=0;this.loadId=0;try{const saved=wx.getStorageSync('favorites');this.setData({favorites:Array.isArray(saved)?saved:[]});}catch(e){}if(options.q)this.setData({query:options.q});this.loadEdition();},
 onUnload(){this.loadId++;if(this.worker)this.worker.terminate();},
 async loadEdition(){const token=++this.loadId;this.request++;this.setData({loading:true,ready:false,status:'正在加载文字库…',results:[],selected:null,preview:''});if(this.worker){this.worker.terminate();this.worker=null;}
  const m=editions[this.data.editionIndex];
  try{const chunks=await loadLibrary(m.id);
   if(token!==this.loadId)return;
   this.worker=wx.createWorker('workers/search.js');
   this.worker.onMessage(msg=>{if(token!==this.loadId)return;if(msg.type==='ready'){this.setData({ready:true,loading:false,count:msg.count,status:'文字库已就绪 · '+msg.count+' 节'});if(this.data.query)this.search();}
    if(msg.type==='results'&&msg.request===this.request){const results=msg.results.map((r,i)=>({...r,key:r.version+'-'+r.book+'-'+r.chapter+'-'+r.verse,label:r.exact?'原文命中':r.score>1?'相近表达':'字词相关',expanded:false}));this.setData({results,loading:false,status:results.length?'找到 '+results.length+' 条回声':'没有找到接近的原句，试试更短的关键词',selected:results[0]||null});this.updatePreview();}
    if(msg.type==='error')this.fail(msg.message);
   });
   this.worker.postMessage({type:'init',conversion,data:{...chunks[0],verses:chunks.reduce((a,c)=>a.concat(c.verses),[])}});
  }catch(e){console.error('Library load failed',e.message,e.errMsg,e.stack);if(token===this.loadId)this.fail('文字库加载失败，点击重试');}
 },
 fail(text){this.setData({loading:false,status:text||'搜索失败，请重试'});},
 noop(){},
 toggleSettings(){this.setData({showSettings:!this.data.showSettings});},
 clearQuery(){this.request++;this.setData({query:'',results:[],selected:null,preview:'',showFavorites:false,loading:!this.data.ready,status:this.data.ready?'输入日常话，或点击上方例句开始':'正在准备文字库…'});},
 paste(){wx.getClipboardData({success:r=>{const query=(r.data||'').trim().slice(0,120);this.setData({query});if(query&&this.data.ready&&!this.data.loading)this.search();},fail:()=>wx.showToast({title:'无法读取剪贴板，可长按输入框粘贴',icon:'none'})});},
 input(e){this.setData({query:e.detail.value});},
 search(){if(this.data.loading)return;const query=this.data.query.trim();if(!query){wx.showToast({title:'先写下你想说的话',icon:'none'});return;}if(!this.data.ready){this.loadEdition();return;}this.setData({loading:true,showFavorites:false,status:'正在寻找这句话的回声…',selected:null,preview:''});this.worker.postMessage({type:'search',request:++this.request,query,mode:this.data.mode});},
 example(e){if(this.data.loading)return;this.setData({query:e.currentTarget.dataset.q});this.search();},
 changeEdition(e){this.setData({editionIndex:Number(e.detail.value)});this.loadEdition();},
 changeMode(e){if(this.data.loading)return;this.setData({mode:e.currentTarget.dataset.mode});if(this.data.query)this.search();},
 select(e){const list=this.data.showFavorites?this.data.favorites:this.data.results;this.setData({selected:list[e.currentTarget.dataset.index]});this.updatePreview();},
 context(e){const field=this.data.showFavorites?'favorites':'results';const i=e.currentTarget.dataset.index;this.setData({[field+'['+i+'].expanded']:!this.data[field][i].expanded});},
 updatePreview(){this.setData({preview:this.data.selected?formatQuote(this.data.selected,{whole:this.data.whole,withVersion:this.data.withVersion,template:this.data.template}):''});},
 toggleWhole(e){this.setData({whole:e.detail.value});this.updatePreview();},
 toggleVersion(e){this.setData({withVersion:e.detail.value});this.updatePreview();},
 editTemplate(e){this.setData({template:e.detail.value});this.updatePreview();},
 resetTemplate(){this.setData({template:'“{text}”（{book} {chapter}:{verse}）'});this.updatePreview();},
 copy(){if(!this.data.preview)return;wx.setClipboardData({data:this.data.preview,fail:()=>wx.showToast({title:'复制失败，请重试',icon:'none'})});},
 favorite(){const r=this.data.selected;if(!r)return;let favorites=this.data.favorites;const exists=favorites.some(x=>x.key===r.key);favorites=exists?favorites.filter(x=>x.key!==r.key):[r,...favorites].slice(0,100);try{wx.setStorageSync('favorites',favorites);this.setData({favorites});wx.showToast({title:exists?'已取消收藏':'已存入收藏',icon:'none'});}catch(e){wx.showToast({title:'收藏保存失败',icon:'none'});}},
 toggleFavorites(){const show=!this.data.showFavorites;this.setData({showFavorites:show,selected:show?this.data.favorites[0]||null:this.data.results[0]||null});this.updatePreview();},
 about(){wx.navigateTo({url:'/pages/about/index'});},
 onShareAppMessage(){return {title:'言有出处 · 日常聊天，句句有来头',path:'/pages/index/index'+(this.data.query?'?q='+encodeURIComponent(this.data.query):''),imageUrl:'/assets/icon.png'};},
 onShareTimeline(){return {title:'言有出处 · 给日常聊天找一句回声',query:this.data.query?'q='+encodeURIComponent(this.data.query):''};}
});



