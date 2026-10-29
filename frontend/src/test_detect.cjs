const fs=require('fs'),jpeg=require('jpeg-js'),glob=require('path');
const D=require('./cell_detect.js');
const {execSync}=require('child_process');
const files=execSync(`find "/tmp/claude-0/cap/Cappstone project B" -name "*.jpg"`,{maxBuffer:64e6}).toString().trim().split("\n");
const byCls={}; for(const f of files){const c=f.split('/').slice(-2)[0].replace(/.*(baso|eosino|lympho|metamyelo|mono|myelocyte|neutro|promyelo).*/i,'$1').toLowerCase(); (byCls[c]=byCls[c]||[]).push(f);}
let rng=1; const rand=()=>(rng=(rng*16807)%2147483647)/2147483647;
const res={};
for(const [c,list] of Object.entries(byCls)){
  const pick=[...list].sort(()=>rand()-.5).slice(0,40); const st={n:0,one:0,zero:0,multi:0,centred:0,plt:0,rbc:0};
  for(const f of pick){const im=jpeg.decode(fs.readFileSync(f),{useTArray:true}); const r=D.detect(im.data,im.width,im.height);
    st.n++; const k=r.wbc.length; if(k===0)st.zero++; else if(k===1)st.one++; else st.multi++;
    if(r.wbc.some(b=>Math.abs(b.cx-im.width/2)<60&&Math.abs(b.cy-im.height/2)<60))st.centred++; st.plt+=r.platelets; st.rbc+=r.rbc;}
  res[c]=`one ${st.one}/${st.n} zero ${st.zero} multi ${st.multi} centred ${st.centred} | mean RBC ${(st.rbc/st.n).toFixed(1)} plt ${(st.plt/st.n).toFixed(1)}`;
}
console.log(res);
// mosaic of 4 different cells
const four=Object.values(byCls).slice(0,4).map(l=>jpeg.decode(fs.readFileSync(l[5]),{useTArray:true}));
const W=720,H=720,m=new Uint8Array(W*H*4);
four.forEach((im,k)=>{const ox=(k%2)*360,oy=(k>>1)*360;for(let y=0;y<360;y++)for(let x=0;x<360;x++)for(let ch=0;ch<4;ch++)m[4*((oy+y)*W+ox+x)+ch]=im.data[4*(y*im.width+x)+ch];});
const r=D.detect(m,W,H); console.log('mosaic WBC found:',r.wbc.length, r.wbc.map(b=>[b.cx,b.cy,b.size]), 'rbcD',r.rbcDiameter.toFixed(1),'thr',r.nucleusThreshold);
// debug extras
const f0=byCls.eosino[3];const im=jpeg.decode(fs.readFileSync(f0),{useTArray:true});const rr=D.detect(im.data,im.width,im.height);
console.log('eos example', rr.wbc.map(b=>({cx:b.cx,cy:b.cy,area:b.area,edge:b.touchesEdge})), 'rbcD',rr.rbcDiameter.toFixed(1));
