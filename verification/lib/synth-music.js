// 譜面の検証用の合成音（ピアノ風・Karplus-Strong の弦・ベース・ドラム）と、拍ごとのコード名から曲を作る関数
const FS=48000;let sd=11;const rnd=()=>((sd=sd*16807%2147483647)/2147483647-.5);
const hz=(p,a4=440)=>a4*Math.pow(2,(p-69)/12);
// ピアノ風：倍音 1/h、高い倍音ほど速く減衰
function piano(x,p,t0,dur,amp,a4){const f=hz(p,a4),s=Math.round(t0*FS),n=Math.round((dur+0.3)*FS);for(let h=1;h<=10;h++){const fh=f*h*Math.sqrt(1+0.0004*h*h);if(fh>FS/2-1000)break;const a=amp/Math.pow(h,1.1),dk=1.2+0.5*h;for(let i=0;i<n&&s+i<x.length;i++){const t=i/FS,env=Math.exp(-dk*t)*Math.min(1,t/0.004)*(t>dur?Math.exp(-(t-dur)*30):1);x[s+i]+=a*env*Math.sin(2*Math.PI*fh*t+h);}}}
// Karplus-Strong（ギターの弦）
function pluck(x,p,t0,dur,amp,a4){const f=hz(p,a4),P=FS/f,D=P-0.5,N=Math.floor(D-0.5),fr=D-N,buf=new Float64Array(N+2);for(let i=0;i<buf.length;i++)buf[i]=rnd()*2;for(let r=0;r<3;r++){let z=buf[buf.length-1];for(let i=0;i<buf.length;i++){z=0.5*z+0.5*buf[i];buf[i]=z;}}let mm=0;for(const v of buf)mm+=v/buf.length;let mx=0;for(let i=0;i<buf.length;i++){buf[i]-=mm;mx=Math.max(mx,Math.abs(buf[i]));}for(let i=0;i<buf.length;i++)buf[i]/=mx||1;let k=0,prev=0;const s=Math.round(t0*FS),n=Math.round(dur*FS);
  // 遅延 = N（バッファ）+ 0.5（平均）+ fr（1 次のオールパス、0.5〜1.5 で安定）
  const c=(1-fr)/(1+fr);let ap=0,apx=0;
  for(let i=0;i<n&&s+i<x.length;i++){const a=buf[k],b=buf[(k+1)%N];let y=0.4985*(a+b);const z=c*y+apx-c*ap;apx=y;ap=z;buf[k]=z;k=(k+1)%N;const t=i/FS,rel=t>dur-0.03?Math.max(0,(dur-t)/0.03):1;x[s+i]+=amp*a*rel;}}
function kick(x,t0,amp){const s=Math.round(t0*FS);for(let i=0;i<9000&&s+i<x.length;i++){const t=i/FS;x[s+i]+=amp*Math.exp(-t*18)*Math.sin(2*Math.PI*(50+80*Math.exp(-t*40))*t);}}
function snare(x,t0,amp){const s=Math.round(t0*FS);for(let i=0;i<7000&&s+i<x.length;i++){const t=i/FS;x[s+i]+=amp*Math.exp(-t*25)*(rnd()*1.4+0.4*Math.sin(2*Math.PI*190*t));}}
function hat(x,t0,amp){const s=Math.round(t0*FS);let lp=0;for(let i=0;i<2000&&s+i<x.length;i++){const t=i/FS,r=rnd();const hp=r-lp;lp=r;x[s+i]+=amp*Math.exp(-t*80)*hp;}}
function bass(x,p,t0,dur,amp,a4){const f=hz(p,a4),s=Math.round(t0*FS),n=Math.round(dur*FS);for(let i=0;i<n&&s+i<x.length;i++){const t=i/FS,env=Math.exp(-t*1.5)*Math.min(1,t/0.006)*Math.min(1,(dur-t)/0.02);let v=0;for(let h=1;h<=6;h++)v+=Math.sin(2*Math.PI*f*h*t)/(h*h*0.7+0.3);x[s+i]+=amp*env*v;}}
const NAMES=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const TYPES={"":[0,4,7],"m":[0,3,7],"7":[0,4,7,10],"M7":[0,4,7,11],"m7":[0,3,7,10],"sus4":[0,5,7],"dim":[0,3,6],"aug":[0,4,8],"m7-5":[0,3,6,10]};
function parse(nm){const m=/^([A-G]#?)(m7-5|M7|m7|sus4|dim|aug|m|7|)(?:\/([A-G]#?))?$/.exec(nm);const r=NAMES.indexOf(m[1]);return {root:r,type:m[2],bass:m[3]?NAMES.indexOf(m[3]):r};}
// prog: 拍ごとのコード名の配列（小節 × meter）
function song(o){
  const bpm=o.bpm,meter=o.meter||4,a4=o.a4||440,off=o.off||0.37,beatsN=o.chords.length,dur=off+beatsN*60/bpm+2,x=new Float32Array(Math.round(dur*FS)),spb=60/bpm;
  const beats=[];for(let i=0;i<=beatsN;i++)beats.push(off+i*spb);
  for(let i=0;i<beatsN;i++){
    const c=parse(o.chords[i]),t=beats[i],newC=i===0||o.chords[i]!==o.chords[i-1],bar=i%meter===0;
    // 和音：コードが変わる拍と小節の頭で弾き直す
    if(newC||bar||(o.comp==="every")){let len=1;while(i+len<beatsN&&o.chords[i+len]===o.chords[i]&&(i+len)%meter!==0&&o.comp!=="every")len++;
      const tones=TYPES[c.type].map(v=>(c.root+v)%12);for(const pc of tones){let p=60+pc;if(p>67)p-=12;o.inst==="guitar"?pluck(x,p,t+0.003*pc,len*spb,0.08,a4):piano(x,p,t,len*spb,0.07,a4);}
      if(o.top)piano(x,72+tones[0]>79?60+tones[0]:72+tones[0],t,len*spb,0.03,a4);}
    if(o.bass!==false){let bp=36+c.bass;if(bp>45)bp-=12;bass(x,bp,t,spb*0.9,0.18,a4);}
    if(o.drums!==false){if(i%2===0)kick(x,t,i%meter===0?0.5:0.35);else snare(x,t,0.25);hat(x,t,0.15);hat(x,t+spb/2,0.1);}
    if(o.melody){const tones=TYPES[c.type];for(let h=0;h<2;h++){const pc=(c.root+tones[Math.floor(Math.abs(rnd())*7)%tones.length]+(Math.abs(rnd())<0.3?2:0))%12;piano(x,72+pc,t+h*spb/2,spb/2,0.04,a4);}}
  }
  if(o.noise)for(let i=0;i<x.length;i++)x[i]+=o.noise*rnd();
  return {x,beats,chords:o.chords.map(parse),meter};
}
module.exports={FS,rnd,hz,piano,pluck,kick,snare,hat,bass,song,parse,NAMES,TYPES};
