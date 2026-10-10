const api = globalThis.browser || globalThis.chrome;
const slider=document.getElementById('volume');
const amount=document.getElementById('amount');
const tabsEl=document.getElementById('tabs');
const title=document.getElementById('tabname');
let currentTab, saved={}, sequence=0;

// This function executes in the page's MAIN world, where the native media player lives.
// It is intentionally self-contained and does not access extension APIs or remote servers.
function controlPageVolume(value) {
  const key='__noizrosVolumeController13';
  let c=window[key];
  if (!c) {
    const states=new WeakMap();
    let context=null;
    c={level:100,apply:null};
    const ensure=(el)=>{
      if(states.has(el))return states.get(el);
      const s={kind:'native',original:el.volume,internal:false};
      states.set(el,s);
      try {
        const AudioCtx=window.AudioContext||window.webkitAudioContext;
        if(!AudioCtx)throw Error('AudioContext not available');
        context ||= new AudioCtx();
        const src=context.createMediaElementSource(el);
        const gain=context.createGain();
        src.connect(gain);gain.connect(context.destination);
        s.kind='gain';s.gain=gain;
      }catch(e){
        el.addEventListener('volumechange',()=>{
          if(!s.internal && c.level===100)s.original=el.volume;
        });
      }
      return s;
    };
    const apply=(el)=>{
      const s=ensure(el);
      if(s.kind==='gain'){
        s.gain.gain.value=c.level/100;
      }else{
        const v=Math.max(0,Math.min(1,s.original*c.level/100));
        if(Math.abs(el.volume-v)>0.001){
          s.internal=true;el.volume=v;
          setTimeout(()=>{s.internal=false},0);
        }
      }
    };
    c.apply=()=>{
      document.querySelectorAll('audio,video').forEach(apply);
      if(context?.state==='suspended')context.resume().catch(()=>{});
    };
    const observer=new MutationObserver((records)=>{
      if(!records.some(r=>r.addedNodes.length))return;
      c.apply();
    });
    observer.observe(document.documentElement||document,{subtree:true,childList:true});
    document.addEventListener('play',()=>c.apply(),true);
    window[key]=c;
  }
  c.level=Math.max(0,Math.min(100,Number(value)||0));
  c.apply();
}

async function applyVolume(tabId,value){
  // Avoid racing successive slider movements: only the latest value wins.
  const token=++sequence;
  try {
    await api.tabs.update(tabId,{muted:value===0});
    if(token!==sequence)return;
    await api.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:controlPageVolume,args:[value]});
  } catch(e) {console.warn('noizros Volume Master: this page may restrict audio control',e);}
}
async function select(tab){
  title.textContent=tab.title||'Current tab';
  const v=tab.mutedInfo?.muted?0:(saved[String(tab.id)]??100);
  slider.value=v;amount.textContent=v+'%';
  await applyVolume(tab.id,v);
}
async function init(){
  saved=(await api.storage.local.get('volumes')).volumes||{};
  const tabs=await api.tabs.query({currentWindow:true});
  currentTab=tabs.find(t=>t.active);
  if(currentTab)void select(currentTab);
  for(const tab of tabs.filter(t=>!t.url?.startsWith('chrome:')&&!t.url?.startsWith('about:'))){
    const btn=document.createElement('button');btn.className='tab'+(tab.id===currentTab?.id?' active':'');
    if(tab.favIconUrl&&/^(https?:|data:image\/)/.test(tab.favIconUrl)){
      const img=document.createElement('img');img.src=tab.favIconUrl;img.onerror=()=>img.remove();btn.append(img);
    }
    const label=document.createElement('span');label.className='name';label.textContent=tab.title||'Untitled tab';btn.append(label);
    const state=document.createElement('span');state.className='state';state.textContent=tab.mutedInfo?.muted?'Muted':tab.audible?'♫':'';btn.append(state);
    btn.onclick=()=>{currentTab=tab;tabsEl.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));btn.classList.add('active');void select(tab);};
    tabsEl.append(btn);
  }
}
let latest=100, running=false;
async function drain(){
  if(running)return;
  running=true;
  while(true){
    const v=latest;
    const tabId=currentTab?.id;
    if(tabId!=null)await applyVolume(tabId,v);
    if(v===latest)break;
  }
  running=false;
}
function setVolume(value){
  if(!currentTab)return;
  const v=Math.max(0,Math.min(100,Number(value)));
  latest=v;amount.textContent=v+'%';slider.value=v;
  saved[String(currentTab.id)]=v;
  void api.storage.local.set({volumes:saved});
  void drain();
}
slider.addEventListener('input',()=>setVolume(slider.value));
document.getElementById('mute').onclick=()=>setVolume(0);
document.getElementById('reset').onclick=()=>setVolume(100);
init().catch(()=>{title.textContent='Cannot access this tab'});
