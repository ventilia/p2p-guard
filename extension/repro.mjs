class El {
  constructor(t,x=''){this.tag=t;this.own=x;this.children=[];this.parentElement=null;}
  add(c){c.parentElement=this;this.children.push(c);return this;}
  get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this.own;}
  get nextElementSibling(){const k=this.parentElement?.children??[];return k[k.indexOf(this)+1]??null;}
  get previousElementSibling(){const k=this.parentElement?.children??[];return k[k.indexOf(this)-1]??null;}
  flatten(){return [this,...this.children.flatMap(c=>c.flatten())];}
}
const pair=(l,v)=>new El('div').add(new El('span',l)).add(new El('b',v));
function installDom(root, bodyText, url){
  globalThis.location={pathname:url.split('?')[0],search:url.includes('?')?'?'+url.split('?')[1]:'',href:'https://p2p.binance.com'+url};
  const all=root.flatten();
  globalThis.document={querySelectorAll:(sel)=>{const t=sel.split(',').map(s=>s.trim());return all.filter(e=>t.includes(e.tag));},body:{innerText:bodyText}};
}
const page=new El('div'); page.add(pair('Все сделки','885 Раз(а)'));
installDom(page,'Почта SMS Подтверждение личности','/ru/advertiserDetail?advertiserNo=abc123456');
console.log('location:', globalThis.location);
const m=await import('./src/content/statsScrape.js');
console.log('onProfilePage:', m.onProfilePage());
console.log('stats:', m.scrapeCounterpartyStats());
