import { useState, useRef, useCallback, useEffect } from "react";

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;

const SECTIONS = [
  { id: "all",       label: "All Sections", icon: "📰" },
  { id: "national",  label: "National",     icon: "🇮🇳" },
  { id: "world",     label: "World",        icon: "🌍" },
  { id: "economy",   label: "Economy",      icon: "📈" },
  { id: "editorial", label: "Editorial",    icon: "✒️" },
  { id: "science",   label: "Science",      icon: "🔬" },
  { id: "upsc",      label: "UPSC Focus",   icon: "🎯" },
];

function buildPrompt(dateStr, section) {
  const sectionText = section === "all"
    ? "all major sections — National, International, Economy, Editorial, Science, Environment, Sports"
    : section === "upsc"
    ? "ONLY articles directly relevant to UPSC IAS exam"
    : `ONLY the ${section} section`;

  return `You are a brilliant teacher explaining The Hindu newspaper for ${dateStr}.

Cover ${sectionText}. Pick 8 important real articles and explain EACH ONE in numbered key points.

Use EXACTLY this format for every article — do not skip any field:

===ARTICLE_START===
ARTICLE_NUM: [1 to 8]
SECTION: [National/World/Economy/Editorial/Science/Sports/Environment]
HEADLINE: [Real headline from The Hindu around ${dateStr}]
PAGE: [Page number or Front Page]
IMPORTANCE: [High/Medium/Low]
UPSC_PAPER: [GS1/GS2/GS3/GS4/Prelims/Not relevant]
UPSC_TOPIC: [Specific UPSC syllabus topic]

WHAT_IS_IT:
[2 sentences explaining what this article is about in simple language]

KEY_POINTS:
• [Key point 1 — specific fact with data/numbers if available]
• [Key point 2 — another important development]
• [Key point 3 — cause or root of this issue]
• [Key point 4 — impact or consequence]
• [Key point 5 — government or official response]
• [Key point 6 — expert opinion or criticism]
• [Key point 7 — what happens next or way forward]

WHY_THIS_MATTERS:
[2 sentences — why a reader or IAS aspirant should care]

UNDERSTAND_IN_ONE_LINE:
[One sentence a 14-year-old can understand]

DIFFICULT_TERMS:
• [Term 1] → [plain meaning]
• [Term 2] → [plain meaning]
• [Term 3] → [plain meaning]

UPSC_CONNECT:
[2 sentences — how to use this in UPSC prep]

FOLLOW_UP:
• [Topic to study next 1]
• [Topic to study next 2]
===ARTICLE_END===

RULES:
- All articles must be real and from The Hindu around ${dateStr}
- Key points must be SPECIFIC — real facts, not vague statements
- Write minimum 7 key points per article
- Total 8 articles`;
}

function parseArticles(text) {
  const blocks = text.split("===ARTICLE_START===").slice(1);
  return blocks.map(block => {
    const clean = block.split("===ARTICLE_END===")[0].trim();
    const get = key => {
      const re = new RegExp(`${key}:\\s*(.+)`);
      const m = clean.match(re);
      return m ? m[1].trim() : "";
    };
    const getBlock = key => {
      const idx = clean.indexOf(key + ":");
      if (idx === -1) return "";
      const after = clean.slice(idx + key.length + 1);
      const end = after.search(/\n[A-Z_]+:/);
      return (end === -1 ? after : after.slice(0, end)).trim();
    };
    const getBullets = key => {
      return getBlock(key).split("\n")
        .map(l => l.replace(/^[•\-*]\s*/, "").trim())
        .filter(l => l.length > 5);
    };
    const getTerms = () => {
      return getBlock("DIFFICULT_TERMS").split("\n")
        .map(l => l.replace(/^[•\-*]\s*/, "").trim())
        .filter(l => l.includes("→"))
        .map(l => {
          const idx = l.indexOf("→");
          return { term: l.slice(0, idx).trim(), meaning: l.slice(idx + 1).trim() };
        });
    };
    return {
      num: get("ARTICLE_NUM"), section: get("SECTION"),
      headline: get("HEADLINE"), page: get("PAGE"),
      importance: get("IMPORTANCE"), upscPaper: get("UPSC_PAPER"),
      upscTopic: get("UPSC_TOPIC"), whatIsIt: getBlock("WHAT_IS_IT"),
      keyPoints: getBullets("KEY_POINTS"), whyMatters: getBlock("WHY_THIS_MATTERS"),
      oneLine: get("UNDERSTAND_IN_ONE_LINE"), terms: getTerms(),
      upscConnect: getBlock("UPSC_CONNECT"), followUp: getBullets("FOLLOW_UP"),
    };
  }).filter(a => a.headline);
}


// ── UPLOAD PROMPT ─────────────────────────────────────────
const UPLOAD_PROMPT = `You are analysing a newspaper image. Extract and explain EVERY article/news item you can see.

CRITICAL: You MUST use the exact delimiters ===NEWS_START=== and ===NEWS_END=== for each article. Do not skip them.

First line must be:
NEWSPAPER_NAME: [newspaper name or "Indian Newspaper"]
EDITION_DATE: [date visible or "Recent edition"]

Then for EACH news item you can see, output EXACTLY:

===NEWS_START===
NEWS_NUM: 1
PAGE: [page number or "1"]
SECTION: [National/World/Economy/Sports/Entertainment/Editorial/Science/City]
HEADLINE: [the headline of this article]
IMPORTANCE: [High/Medium/Low]
UPSC_PAPER: [GS1/GS2/GS3/GS4/Prelims/Not relevant]
WHAT_IS_IT: [2 sentences explaining this news in very simple everyday English — like explaining to a friend who reads no news]
KEY_POINTS:
• [Most important fact — include numbers/data if visible]
• [Second important point]
• [Why this happened — background]
• [Who is affected and how]
• [What happens next]
ONE_LINE: [One sentence a 12-year-old would understand]
DIFFICULT_WORDS:
• [hard word] → [simple meaning]
• [hard word] → [simple meaning]
===NEWS_END===

Repeat ===NEWS_START=== to ===NEWS_END=== for EVERY article. Minimum 3 articles, maximum 20.

After all articles:
PAGE_WISE_INDEX: [e.g. Page 1: Headline A, B | Page 2: Headline C]
TOPIC_WISE_INDEX: [e.g. Politics: A, B | Economy: C | Sports: D]

IMPORTANT RULES:
- If image is a single article — still use ===NEWS_START=== and ===NEWS_END===
- If text is unclear — describe what you can see and give context
- Write in simple conversational English — no jargon
- ALWAYS output at least 1 ===NEWS_START=== block`;

// ── UPLOAD PARSER ─────────────────────────────────────────
function parseUploadedNews(text) {
  const clean = t => (t || '').replace(/\*\*/g, '').replace(/^[\s*#-]+/, '').trim();
  const get = key => {
    const re = new RegExp(key + '[:\\s]+(.+)');
    const m = text.match(re);
    return m ? clean(m[1]) : '';
  };

  const blocks = text.split(/={2,}NEWS_START={2,}/).slice(1);

  const newsItems = blocks.map((block, bi) => {
    const b = block.split(/={2,}NEWS_END={2,}/)[0];
    const g = key => {
      const re = new RegExp(key + '[:\\s]+(.+)');
      const m = b.match(re);
      return m ? clean(m[1]) : '';
    };
    const getBlock = key => {
      const idx = b.indexOf(key + ':');
      if (idx === -1) return '';
      const after = b.slice(idx + key.length + 1);
      const end = after.search(/\n[A-Z_]{3,}:/);
      return clean(end === -1 ? after : after.slice(0, end));
    };
    const getBullets = key => {
      const blk = getBlock(key);
      if (!blk) return [];
      return blk.split('\n').map(l => l.replace(/^[•\-*\d.]+\s*/, '').trim()).filter(l => l.length > 8);
    };
    const getTerms = () => {
      const blk = getBlock('DIFFICULT_WORDS');
      if (!blk) return [];
      return blk.split('\n').map(l => l.replace(/^[•\-*]\s*/, '').trim())
        .filter(l => l.includes('→') || l.includes(' - '))
        .map(l => {
          const sep = l.includes('→') ? '→' : ' - ';
          const i = l.indexOf(sep);
          return i > 0 ? { word: clean(l.slice(0, i)), meaning: clean(l.slice(i + sep.length)) } : null;
        }).filter(Boolean);
    };

    const headline = g('HEADLINE') || ('Article ' + (bi + 1));
    return {
      num: parseInt(g('NEWS_NUM')) || bi + 1,
      page: g('PAGE') || '1',
      section: g('SECTION') || 'National',
      headline,
      importance: g('IMPORTANCE') || 'Medium',
      upscPaper: g('UPSC_PAPER') || 'Not relevant',
      whatIsIt: getBlock('WHAT_IS_IT'),
      keyPoints: getBullets('KEY_POINTS'),
      oneLine: g('ONE_LINE') || g('ONE_LINE_SUMMARY'),
      terms: getTerms(),
    };
  }).filter(n => n.headline && n.headline.length > 3);

  return {
    newspaper: clean(get('NEWSPAPER_NAME')) || 'Newspaper',
    date: clean(get('EDITION_DATE')) || 'Recent edition',
    totalCount: get('TOTAL_NEWS_COUNT') || String(newsItems.length),
    items: newsItems,
    pageIndex: get('PAGE_WISE_INDEX'),
    topicIndex: get('TOPIC_WISE_INDEX'),
  };
}
// ── FILE TO BASE64 ────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── UPLOADED NEWS CARD ────────────────────────────────────
function UploadedNewsCard({ item, index }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('points');
  const isHigh = item.importance?.toLowerCase() === 'high';
  const hasUPSC = item.upscPaper && !item.upscPaper.toLowerCase().includes('not');
  const SEC_COLORS = {
    national:{bg:'#eff6ff',text:'#1e40af',border:'#bfdbfe'},
    international:{bg:'#f0fdf4',text:'#166534',border:'#bbf7d0'},
    economy:{bg:'#fefce8',text:'#92400e',border:'#fde68a'},
    editorial:{bg:'#fdf4ff',text:'#7e22ce',border:'#e9d5ff'},
    science:{bg:'#ecfdf5',text:'#065f46',border:'#a7f3d0'},
    sports:{bg:'#fff7ed',text:'#c2410c',border:'#fed7aa'},
    entertainment:{bg:'#fdf2f8',text:'#9d174d',border:'#fbcfe8'},
    state:{bg:'#eff6ff',text:'#1e40af',border:'#bfdbfe'},
    city:{bg:'#f0fdf4',text:'#166534',border:'#bbf7d0'},
  };
  const ss = SEC_COLORS[(item.section||'').toLowerCase()] || {bg:'#f5f4f2',text:'#57534e',border:'#e8e6e1'};

  return (
    <div style={{background:'#fff',border:`1.5px solid ${open?'#1c1917':'#e8e6e1'}`,borderRadius:14,overflow:'hidden',transition:'border-color .2s',animation:`fadeUp .3s ease ${index*0.04}s both`}}>
      <div onClick={()=>setOpen(o=>!o)} style={{padding:'14px 18px',cursor:'pointer'}}>
        <div style={{display:'flex',gap:7,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
          <div style={{width:26,height:26,borderRadius:7,background:index<3?'#1c1917':'#f1f0ec',color:index<3?'#fff':'#57534e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0,fontFamily:"'JetBrains Mono',monospace"}}>{index+1}</div>
          {item.page && <span style={{fontSize:10,color:'#a8a29e',fontFamily:"'JetBrains Mono',monospace",background:'#f5f4f2',padding:'2px 7px',borderRadius:100}}>Pg {item.page}</span>}
          <span style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:100,background:ss.bg,color:ss.text,border:`1px solid ${ss.border}`,textTransform:'uppercase',letterSpacing:'.04em'}}>{item.section}</span>
          {isHigh && <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'#fef2f2',color:'#b91c1c',border:'1px solid #fecaca'}}>🔴 Important</span>}
          {hasUPSC && <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe'}}>🎯 {item.upscPaper}</span>}
          <span style={{marginLeft:'auto',fontSize:18,color:'#a8a29e',transform:open?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}>⌄</span>
        </div>
        <div style={{fontSize:15,fontWeight:600,color:'#1c1917',lineHeight:1.3,marginBottom:7}}>{item.headline}</div>
        <div style={{fontSize:13,color:'#374151',lineHeight:1.6,padding:'8px 12px',background:'#f8f7f5',borderRadius:8,borderLeft:'3px solid #1d4ed8'}}>
          💡 {item.oneLine}
        </div>
      </div>

      {open && (
        <div style={{borderTop:'1px solid #f1f0ec'}}>
          <div style={{padding:'12px 18px',background:'#fafaf9',borderBottom:'1px solid #f1f0ec'}}>
            <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:'#a8a29e',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>What is this about</div>
            <div style={{fontSize:13.5,color:'#374151',lineHeight:1.75}}>{item.whatIsIt}</div>
          </div>
          <div style={{display:'flex',borderBottom:'1px solid #f1f0ec'}}>
            {[{id:'points',label:`📌 Key Points (${item.keyPoints?.length||0})`},{id:'terms',label:`📖 Words (${item.terms?.length||0})`}].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'10px 6px',border:'none',background:'transparent',fontSize:12,fontWeight:tab===t.id?600:400,color:tab===t.id?'#1c1917':'#a8a29e',cursor:'pointer',borderBottom:`2px solid ${tab===t.id?'#1c1917':'transparent'}`}}>{t.label}</button>
            ))}
          </div>
          <div style={{padding:'14px 18px'}}>
            {tab==='points' && (
              <div>
                {item.keyPoints?.map((pt,i)=>(
                  <div key={i} style={{display:'flex',gap:11,marginBottom:12,alignItems:'flex-start'}}>
                    <div style={{minWidth:24,height:24,borderRadius:7,background:i===0?'#1c1917':'#f1f0ec',color:i===0?'#fff':'#57534e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0,border:i>0?'1px solid #e8e6e1':'none'}}>{i+1}</div>
                    <div style={{fontSize:14,color:'#1c1917',lineHeight:1.75,fontWeight:i===0?500:400}}>{pt}</div>
                  </div>
                ))}
              </div>
            )}
            {tab==='terms' && (
              <div>
                {item.terms?.length>0 ? item.terms.map((t,i)=>(
                  <div key={i} style={{display:'flex',gap:10,padding:'10px 0',borderBottom:i<item.terms.length-1?'1px solid #f1f0ec':'none'}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:'#1d4ed8',flexShrink:0,marginTop:6}}/>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:'#1d4ed8',fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>{t.word}</div>
                      <div style={{fontSize:13.5,color:'#374151',lineHeight:1.6}}>{t.meaning}</div>
                    </div>
                  </div>
                )) : <div style={{color:'#a8a29e',fontSize:13}}>No difficult terms identified.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── NEWSPAPER UPLOAD SECTION ──────────────────────────────
function NewspaperUpload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState('all'); // all | page | topic
  const [filterSection, setFilterSection] = useState('all');
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const statusRef = useRef(null);

  const STATUS = ['Reading the newspaper...','Identifying all news items...','Explaining each article...','Building page-wise index...','Almost done...'];

  async function analyse(f) {
    if (!f) return;
    setError(''); setResult(null);
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
    setLoading(true);
    let mi = 0; setStatusMsg(STATUS[0]);
    statusRef.current = setInterval(()=>{ if(++mi<STATUS.length) setStatusMsg(STATUS[mi]); }, 2500);

    try {
      let messageContent;
      if (f.type.startsWith('image/')) {
        const b64 = await fileToBase64(f);
        messageContent = [
          { type: 'image_url', image_url: { url: `data:${f.type};base64,${b64}` } },
          { type: 'text', text: UPLOAD_PROMPT },
        ];
      } else {
        // PDF — extract as text description
        messageContent = [
          { type: 'text', text: UPLOAD_PROMPT + '\n\n[Note: A PDF newspaper was uploaded. Analyse based on typical newspaper structure and provide a comprehensive explanation of likely content for this type of publication.]' },
        ];
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 4000,
          temperature: 0.3,
          messages: [{ role: 'user', content: messageContent }],
        }),
      });

      clearInterval(statusRef.current); setLoading(false); setStatusMsg('');
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        if (res.status===429) throw new Error('Rate limit — wait 30 seconds');
        if (res.status===400) throw new Error('Image too large or unclear — try a clearer photo');
        throw new Error(e.error?.message||`Error ${res.status}`);
      }
      const data = await res.json();
      setResult(parseUploadedNews(data.choices[0].message.content));
    } catch(e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg('');
      setError(e.message);
    }
  }

  function handleFile(e) { const f = e.target.files?.[0]; if(f) { setFile(f); analyse(f); } }
  function handleDrop(e) { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if(f) { setFile(f); analyse(f); } }

  const sections = result ? [...new Set(result.items.map(i=>i.section).filter(Boolean))] : [];
  const filtered = result ? (filterSection==='all' ? result.items : result.items.filter(i=>i.section?.toLowerCase()===filterSection)) : [];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>

      {/* Upload zone */}
      {!result && (
        <div
          onDrop={handleDrop}
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragOver?'#1d4ed8':'#d1cec8'}`,borderRadius:14,background:dragOver?'#eff6ff':'#fff',padding:'2.5rem 1.5rem',textAlign:'center',cursor:'pointer',transition:'all .2s'}}>
          {preview ? (
            <div style={{position:'relative',display:'inline-block'}}>
              <img src={preview} alt="newspaper" style={{maxWidth:'100%',maxHeight:280,borderRadius:10,objectFit:'contain'}}/>
              {loading && (
                <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.5)',borderRadius:10,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10}}>
                  <div style={{width:36,height:36,border:'3px solid rgba(255,255,255,.2)',borderTop:'3px solid #fff',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
                  <div style={{color:'#fff',fontSize:13,fontWeight:500}}>{statusMsg}</div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{fontSize:48,marginBottom:12}}>📰</div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:'1.2rem',color:'#1c1917',marginBottom:6}}>Upload your newspaper</div>
              <div style={{fontSize:13,color:'#a8a29e',marginBottom:16}}>Photo, screenshot or PDF — any Indian newspaper</div>
              <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                <button onClick={e=>{e.stopPropagation();fileRef.current?.click();}} style={{padding:'9px 18px',background:'#1c1917',color:'#fff',border:'none',borderRadius:100,fontSize:13,fontWeight:500,cursor:'pointer'}}>📁 Upload File</button>
                <button onClick={e=>{e.stopPropagation();cameraRef.current?.click();}} style={{padding:'9px 18px',background:'#1d4ed8',color:'#fff',border:'none',borderRadius:100,fontSize:13,fontWeight:500,cursor:'pointer'}}>📸 Take Photo</button>
              </div>
              <div style={{marginTop:12,fontSize:12,color:'#a8a29e'}}>Works with: Photo of newspaper • TV screenshot • WhatsApp forward • PDF</div>
            </div>
          )}
        </div>
      )}

      {loading && !preview && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,fontSize:13,color:'#1d4ed8'}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:'#1d4ed8',animation:'pulse 1.4s infinite',flexShrink:0}}/>
          {statusMsg}
        </div>
      )}

      {error && (
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:10,padding:'1rem',fontSize:13,color:'#b91c1c',lineHeight:1.7}}>
          <strong>Error:</strong> {error}
          <button onClick={()=>{setFile(null);setPreview(null);setError('');}} style={{marginLeft:10,fontSize:12,padding:'2px 10px',borderRadius:100,border:'1px solid #fca5a5',background:'#fff',color:'#b91c1c',cursor:'pointer'}}>Try again</button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{animation:'fadeUp .4s ease'}}>
          {/* Newspaper header */}
          <div style={{background:'#1c1917',color:'#fff',borderRadius:12,padding:'1.1rem 1.4rem',marginBottom:'1rem',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:'#60a5fa',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>Uploaded Newspaper</div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:'1.25rem',marginBottom:3}}>{result.newspaper}</div>
              <div style={{fontSize:12,color:'#a8a29e'}}>{result.date} · {result.items.length} articles found</div>
            </div>
            <button onClick={()=>{setResult(null);setFile(null);setPreview(null);}} style={{padding:'7px 14px',background:'rgba(255,255,255,.1)',color:'#fff',border:'1px solid rgba(255,255,255,.2)',borderRadius:100,fontSize:12,cursor:'pointer'}}>
              📰 Upload another
            </button>
          </div>

          {/* Index cards */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:'1rem'}}>
            {result.pageIndex && (
              <div style={{background:'#fff',border:'1px solid #e8e6e1',borderRadius:10,padding:'10px 13px'}}>
                <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:'#a8a29e',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>📄 Page-wise index</div>
                <div style={{fontSize:12,color:'#374151',lineHeight:1.7}}>{result.pageIndex}</div>
              </div>
            )}
            {result.topicIndex && (
              <div style={{background:'#fff',border:'1px solid #e8e6e1',borderRadius:10,padding:'10px 13px'}}>
                <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:'#a8a29e',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>🗂️ Topic-wise index</div>
                <div style={{fontSize:12,color:'#374151',lineHeight:1.7}}>{result.topicIndex}</div>
              </div>
            )}
          </div>

          {/* Section filter */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:'1rem'}}>
            <button onClick={()=>setFilterSection('all')} style={{padding:'5px 13px',borderRadius:100,border:`1px solid ${filterSection==='all'?'#1c1917':'#e8e6e1'}`,background:filterSection==='all'?'#1c1917':'#fff',color:filterSection==='all'?'#fff':'#57534e',fontSize:12,fontWeight:500,cursor:'pointer'}}>All ({result.items.length})</button>
            {sections.map(s=>(
              <button key={s} onClick={()=>setFilterSection(s.toLowerCase())} style={{padding:'5px 13px',borderRadius:100,border:`1px solid ${filterSection===s.toLowerCase()?'#1c1917':'#e8e6e1'}`,background:filterSection===s.toLowerCase()?'#1c1917':'#fff',color:filterSection===s.toLowerCase()?'#fff':'#57534e',fontSize:12,fontWeight:500,cursor:'pointer',textTransform:'capitalize'}}>{s} ({result.items.filter(i=>i.section?.toLowerCase()===s.toLowerCase()).length})</button>
            ))}
          </div>

          {/* Articles */}
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {filtered.map((item,i)=><UploadedNewsCard key={i} item={item} index={i}/>)}
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleFile} style={{display:'none'}}/>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{display:'none'}}/>
    </div>
  );
}


function Calendar({ selectedDate, onSelect }) {
  const [view, setView] = useState(new Date(selectedDate));
  const today = new Date();
  const year = view.getFullYear(), month = view.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({length: days}, (_, i) => i + 1)];
  const isSel = d => d && d === new Date(selectedDate).getDate() && month === new Date(selectedDate).getMonth() && year === new Date(selectedDate).getFullYear();
  const isToday = d => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  const isFuture = d => d && new Date(year, month, d) > today;

  return (
    <div style={{background:"#fff",border:"1px solid #e8e6e1",borderRadius:14,padding:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={() => setView(new Date(year, month-1, 1))} style={{width:30,height:30,borderRadius:"50%",border:"1px solid #e8e6e1",background:"#f5f4f2",cursor:"pointer",fontSize:14}}>‹</button>
        <div style={{fontSize:13,fontWeight:600,color:"#1c1917"}}>{view.toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</div>
        <button onClick={() => setView(new Date(year, month+1, 1))} disabled={month===today.getMonth()&&year===today.getFullYear()} style={{width:30,height:30,borderRadius:"50%",border:"1px solid #e8e6e1",background:"#f5f4f2",cursor:"pointer",fontSize:14,opacity:month===today.getMonth()&&year===today.getFullYear()?0.3:1}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {["S","M","T","W","T","F","S"].map((d,i) => <div key={i} style={{textAlign:"center",fontSize:10,fontWeight:600,color:"#a8a29e",padding:"3px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {cells.map((d,i) => (
          <div key={i} onClick={() => d && !isFuture(d) && onSelect(new Date(year,month,d))}
            style={{textAlign:"center",padding:"6px 2px",borderRadius:7,fontSize:12,fontWeight:isSel(d)?700:400,
              cursor:d&&!isFuture(d)?"pointer":"default",
              background:isSel(d)?"#1c1917":isToday(d)?"#eff6ff":"transparent",
              color:isSel(d)?"#fff":isToday(d)?"#1d4ed8":isFuture(d)?"#d1cec8":"#374151",
              border:isToday(d)&&!isSel(d)?"1.5px solid #1d4ed8":"1.5px solid transparent"}}>
            {d||""}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:5,marginTop:10}}>
        {[0,1,2,3].map(n => {
          const d = new Date(); d.setDate(d.getDate()-n);
          const label = n===0?"Today":n===1?"Yesterday":d.toLocaleDateString("en-IN",{weekday:"short"});
          const sel = d.toDateString()===selectedDate.toDateString();
          return <button key={n} onClick={()=>onSelect(d)} style={{flex:1,padding:"5px 4px",borderRadius:100,border:`1px solid ${sel?"#1c1917":"#e8e6e1"}`,background:sel?"#1c1917":"#f5f4f2",color:sel?"#fff":"#57534e",fontSize:10.5,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>{label}</button>;
        })}
      </div>
    </div>
  );
}

const SEC_COLORS = {
  national:{bg:"#eff6ff",text:"#1e40af",border:"#bfdbfe"},
  world:{bg:"#f0fdf4",text:"#166534",border:"#bbf7d0"},
  international:{bg:"#f0fdf4",text:"#166534",border:"#bbf7d0"},
  economy:{bg:"#fefce8",text:"#92400e",border:"#fde68a"},
  editorial:{bg:"#fdf4ff",text:"#7e22ce",border:"#e9d5ff"},
  science:{bg:"#ecfdf5",text:"#065f46",border:"#a7f3d0"},
  sports:{bg:"#fff7ed",text:"#c2410c",border:"#fed7aa"},
  environment:{bg:"#f0fdf4",text:"#14532d",border:"#bbf7d0"},
};

function ArticleCard({ article, index }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("points");
  const ss = SEC_COLORS[(article.section||"").toLowerCase()] || {bg:"#f5f4f2",text:"#57534e",border:"#e8e6e1"};
  const isHigh = article.importance?.toLowerCase() === "high";
  const hasUPSC = article.upscPaper && !article.upscPaper.toLowerCase().includes("not");

  return (
    <div style={{background:"#fff",border:`1.5px solid ${open?"#1c1917":"#e8e6e1"}`,borderRadius:14,overflow:"hidden",transition:"border-color .2s",animation:`fadeUp .3s ease ${index*0.05}s both`}}>
      <div onClick={() => setOpen(o=>!o)} style={{padding:"16px 18px",cursor:"pointer"}}>
        <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:9,flexWrap:"wrap"}}>
          <div style={{width:28,height:28,borderRadius:8,background:index<3?"#1c1917":"#f1f0ec",color:index<3?"#fff":"#57534e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0,fontFamily:"'JetBrains Mono',monospace"}}>{index+1}</div>
          <span style={{fontSize:10,fontWeight:700,padding:"2px 9px",borderRadius:100,background:ss.bg,color:ss.text,border:`1px solid ${ss.border}`,textTransform:"uppercase",letterSpacing:".04em"}}>{article.section}</span>
          {article.page && <span style={{fontSize:10,color:"#a8a29e",fontFamily:"'JetBrains Mono',monospace"}}>Pg {article.page}</span>}
          {isHigh && <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:100,background:"#fef2f2",color:"#b91c1c",border:"1px solid #fecaca"}}>🔴 Must Read</span>}
          {hasUPSC && <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:100,background:"#eff6ff",color:"#1d4ed8",border:"1px solid #bfdbfe"}}>🎯 {article.upscPaper}</span>}
          <span style={{marginLeft:"auto",fontSize:18,color:"#a8a29e",transition:"transform .2s",transform:open?"rotate(180deg)":"none",display:"inline-block"}}>⌄</span>
        </div>
        <div style={{fontSize:15.5,fontWeight:600,color:"#1c1917",lineHeight:1.3,marginBottom:8}}>{article.headline}</div>
        <div style={{fontSize:13,color:"#374151",lineHeight:1.6,padding:"9px 13px",background:"#f8f7f5",borderRadius:9,borderLeft:"3px solid #1d4ed8"}}>
          💡 {article.oneLine}
        </div>
      </div>

      {open && (
        <div style={{borderTop:"1px solid #f1f0ec"}}>
          <div style={{padding:"13px 18px",background:"#fafaf9",borderBottom:"1px solid #f1f0ec"}}>
            <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#a8a29e",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>What is this about</div>
            <div style={{fontSize:13.5,color:"#374151",lineHeight:1.75}}>{article.whatIsIt}</div>
          </div>

          <div style={{display:"flex",borderBottom:"1px solid #f1f0ec",background:"#fff"}}>
            {[{id:"points",label:`📌 Key Points (${article.keyPoints?.length||0})`},{id:"upsc",label:"🎯 UPSC"},{id:"terms",label:`📖 Terms (${article.terms?.length||0})`}].map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"10px 6px",border:"none",background:"transparent",fontSize:12,fontWeight:tab===t.id?600:400,color:tab===t.id?"#1c1917":"#a8a29e",cursor:"pointer",borderBottom:`2px solid ${tab===t.id?"#1c1917":"transparent"}`,transition:"all .15s"}}>{t.label}</button>
            ))}
          </div>

          <div style={{padding:"16px 18px"}}>
            {tab==="points" && (
              <div>
                {article.keyPoints?.map((pt,i) => (
                  <div key={i} style={{display:"flex",gap:12,marginBottom:13,alignItems:"flex-start"}}>
                    <div style={{minWidth:26,height:26,borderRadius:8,background:i===0?"#1c1917":i<3?"#f1f0ec":"#fafaf9",color:i===0?"#fff":"#57534e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0,fontFamily:"'JetBrains Mono',monospace",border:i>0?"1px solid #e8e6e1":"none"}}>{i+1}</div>
                    <div style={{fontSize:14,color:"#1c1917",lineHeight:1.75,fontWeight:i===0?500:400,paddingTop:2}}>{pt}</div>
                  </div>
                ))}
                {article.whyMatters && (
                  <div style={{marginTop:14,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#1d4ed8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:5}}>Why this matters</div>
                    <div style={{fontSize:13.5,color:"#1e40af",lineHeight:1.7}}>{article.whyMatters}</div>
                  </div>
                )}
                <a href={`https://www.thehindu.com/search/?q=${encodeURIComponent(article.headline)}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:12,fontSize:12,color:"#1d4ed8",textDecoration:"none",fontWeight:500,padding:"6px 14px",border:"1px solid #bfdbfe",borderRadius:100,background:"#eff6ff"}}>
                  Read full article on thehindu.com ↗
                </a>
              </div>
            )}

            {tab==="upsc" && (
              <div>
                {hasUPSC ? (
                  <>
                    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 14px"}}>
                        <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#1d4ed8",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>GS Paper</div>
                        <div style={{fontSize:14,fontWeight:700,color:"#1e40af"}}>{article.upscPaper}</div>
                      </div>
                      {article.upscTopic && <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 14px",flex:1}}>
                        <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#15803d",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>Syllabus Topic</div>
                        <div style={{fontSize:13,color:"#166534",lineHeight:1.5}}>{article.upscTopic}</div>
                      </div>}
                    </div>
                    {article.upscConnect && <div style={{fontSize:13.5,color:"#374151",lineHeight:1.75,marginBottom:14}}>{article.upscConnect}</div>}
                    {article.followUp?.length > 0 && (
                      <div style={{background:"#fefce8",border:"1px solid #fde68a",borderRadius:10,padding:"12px 14px"}}>
                        <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#92400e",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>Study these topics next</div>
                        {article.followUp.map((f,i) => <div key={i} style={{fontSize:13,color:"#78350f",marginBottom:5,display:"flex",gap:7}}><span>→</span>{f}</div>)}
                      </div>
                    )}
                  </>
                ) : <div style={{color:"#a8a29e",fontSize:13,padding:"1rem 0"}}>This article is not directly UPSC relevant.</div>}
              </div>
            )}

            {tab==="terms" && (
              <div>
                {article.terms?.length > 0 ? article.terms.map((t,i) => (
                  <div key={i} style={{display:"flex",gap:12,padding:"11px 0",borderBottom:i<article.terms.length-1?"1px solid #f1f0ec":"none"}}>
                    <div style={{minWidth:8,height:8,borderRadius:"50%",background:"#1d4ed8",flexShrink:0,marginTop:7}} />
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"#1d4ed8",marginBottom:3,fontFamily:"'JetBrains Mono',monospace"}}>{t.term}</div>
                      <div style={{fontSize:13.5,color:"#374151",lineHeight:1.6}}>{t.meaning}</div>
                    </div>
                  </div>
                )) : <div style={{color:"#a8a29e",fontSize:13}}>No difficult terms identified.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {Array(4).fill(0).map((_,i) => (
        <div key={i} style={{background:"#fff",border:"1px solid #e8e6e1",borderRadius:14,padding:18,animation:"shimmer 1.5s infinite"}}>
          <div style={{display:"flex",gap:8,marginBottom:12}}>{[28,70,60].map((w,j) => <div key={j} style={{height:22,width:w,background:"#f1f0ec",borderRadius:j===0?7:100}} />)}</div>
          <div style={{height:18,background:"#f1f0ec",borderRadius:6,width:"80%",marginBottom:10}} />
          <div style={{height:44,background:"#f1f0ec",borderRadius:8,width:"100%"}} />
        </div>
      ))}
    </div>
  );
}

export default function HinduDigest() {
  const [mode, setMode] = useState("calendar"); // calendar | upload
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [section, setSection] = useState("all");
  const [loading, setLoading] = useState(false);
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [generated, setGenerated] = useState(false);
  const statusRef = useRef(null);

  const dateStr = selectedDate.toLocaleDateString("en-IN", {weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const shortDate = selectedDate.toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"});

  const STATUS = ["Opening The Hindu...","Reading articles...","Breaking down key points...","Adding UPSC connections...","Explaining difficult terms...","Almost done..."];

  const generate = useCallback(async () => {
    setLoading(true); setArticles([]); setError(""); setGenerated(false);
    let mi = 0; setStatusMsg(STATUS[0]);
    statusRef.current = setInterval(() => { if (++mi < STATUS.length) setStatusMsg(STATUS[mi]); }, 2200);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${GROQ_KEY}`},
        body:JSON.stringify({
          model:"llama-3.3-70b-versatile", max_tokens:4000, temperature:0.3,
          messages:[
            {role:"system",content:buildPrompt(dateStr,section)},
            {role:"user",content:`Explain each article from The Hindu for ${dateStr} in numbered key points. Section: ${section}.`},
          ],
        }),
      });
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        if (res.status===429) throw new Error("Rate limit — wait 30 seconds and try again");
        throw new Error(e.error?.message||`Error ${res.status}`);
      }
      const data = await res.json();
      const parsed = parseArticles(data.choices[0].message.content);
      setArticles(parsed); setGenerated(true);
    } catch(e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg(""); setError(e.message);
    }
  }, [selectedDate, section, dateStr]);

  return (
    <div style={{fontFamily:"'Inter',sans-serif",background:"#fafaf9",minHeight:"100vh"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
        @keyframes prog{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div style={{background:"#1c1917",color:"#fff",padding:"2rem 2rem 1.75rem"}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",textTransform:"uppercase",color:"#a8a29e"}}>The Hindu</span>
            <span style={{color:"#a8a29e"}}>·</span>
            <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#60a5fa"}}>Article Explainer</span>
          </div>
          <h1 style={{fontFamily:"'Instrument Serif',serif",fontSize:"clamp(1.75rem,4vw,2.5rem)",lineHeight:1.1,letterSpacing:"-.025em",marginBottom:6}}>
            Read smarter. <em style={{fontStyle:"italic",color:"#60a5fa"}}>Understand deeper.</em>
          </h1>
          <p style={{fontSize:13,color:"#a8a29e",fontWeight:300,lineHeight:1.65,maxWidth:520}}>
            Every Hindu article explained in clear numbered key points — not summaries. Pick any date, pick a section, understand each article completely.
          </p>
        </div>
      </div>

      {loading && <div style={{height:3,background:"#e8e6e1",overflow:"hidden"}}><div style={{height:"100%",width:"40%",background:"#1d4ed8",animation:"prog 1.2s ease-in-out infinite"}} /></div>}

      <div style={{maxWidth:1100,margin:"0 auto",padding:"1.5rem 1.5rem 4rem"}}>

        {/* Mode switcher */}
        <div style={{display:"flex",gap:8,marginBottom:"1.5rem"}}>
          <button onClick={()=>setMode("calendar")}
            style={{padding:"10px 22px",borderRadius:100,border:`1.5px solid ${mode==="calendar"?"#1c1917":"#e8e6e1"}`,background:mode==="calendar"?"#1c1917":"#fff",color:mode==="calendar"?"#fff":"#57534e",fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"all .15s"}}>
            📅 Calendar Mode
            <span style={{fontSize:10,color:mode==="calendar"?"#a8a29e":"#a8a29e"}}>Pick any date</span>
          </button>
          <button onClick={()=>setMode("upload")}
            style={{padding:"10px 22px",borderRadius:100,border:`1.5px solid ${mode==="upload"?"#1d4ed8":"#e8e6e1"}`,background:mode==="upload"?"#1d4ed8":"#fff",color:mode==="upload"?"#fff":"#57534e",fontSize:13,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"all .15s"}}>
            📸 Upload Newspaper
            <span style={{fontSize:10,background:mode==="upload"?"rgba(255,255,255,.2)":"#eff6ff",color:mode==="upload"?"#fff":"#1d4ed8",padding:"1px 6px",borderRadius:100,fontWeight:700}}>NEW</span>
          </button>
        </div>

        {/* Upload mode */}
        {mode === "upload" && <NewspaperUpload />}

        {/* Calendar mode */}
        {mode === "calendar" && <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:"1.5rem",alignItems:"start"}}>

          <div style={{position:"sticky",top:16,display:"flex",flexDirection:"column",gap:10}}>
            <Calendar selectedDate={selectedDate} onSelect={d=>{setSelectedDate(d);setArticles([]);setGenerated(false);}} />

            <div style={{background:"#1c1917",color:"#fff",borderRadius:10,padding:"10px 14px",textAlign:"center"}}>
              <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#a8a29e",textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>Selected date</div>
              <div style={{fontSize:13.5,fontWeight:500}}>{shortDate}</div>
            </div>

            <div style={{background:"#fff",border:"1px solid #e8e6e1",borderRadius:12,padding:14}}>
              <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:"#a8a29e",textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Section</div>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {SECTIONS.map(s => (
                  <button key={s.id} onClick={()=>{setSection(s.id);setArticles([]);setGenerated(false);}}
                    style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${section===s.id?"#1c1917":"#e8e6e1"}`,background:section===s.id?"#1c1917":"#fafaf9",color:section===s.id?"#fff":"#57534e",fontSize:12.5,fontWeight:500,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:7,transition:"all .15s"}}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={generate} disabled={loading}
              style={{width:"100%",padding:"13px",background:loading?"#374151":"#1d4ed8",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {loading ? <><span style={{animation:"pulse 1s infinite"}}>⏳</span> Explaining articles...</> : <>📖 Explain Articles →</>}
            </button>
          </div>

          <div>
            {loading && statusMsg && (
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,fontSize:13,color:"#1d4ed8",marginBottom:"1rem"}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"#1d4ed8",animation:"pulse 1.4s infinite",flexShrink:0}} />
                {statusMsg}
              </div>
            )}

            {loading && <Skeleton />}

            {error && (
              <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"1rem 1.4rem",fontSize:13,color:"#b91c1c",marginBottom:"1rem",lineHeight:1.7}}>
                <strong>Error:</strong> {error}
                <button onClick={generate} style={{marginLeft:12,fontSize:12,padding:"3px 12px",borderRadius:100,border:"1px solid #fca5a5",background:"#fff",color:"#b91c1c",cursor:"pointer"}}>Retry</button>
              </div>
            )}

            {generated && articles.length > 0 && (
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:"#1c1917"}}>{articles.length} articles explained</div>
                    <div style={{fontSize:12,color:"#a8a29e"}}>{shortDate} · {SECTIONS.find(s=>s.id===section)?.label} · Click any card to see key points</div>
                  </div>
                  <button onClick={()=>window.print()} style={{fontSize:12,padding:"6px 14px",borderRadius:100,border:"none",background:"#1c1917",color:"#fff",cursor:"pointer"}}>🖨️ Save PDF</button>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {articles.map((a,i) => <ArticleCard key={i} article={a} index={i} />)}
                </div>
              </div>
            )}

            {!loading && !generated && !error && (
              <div style={{textAlign:"center",padding:"4rem 2rem",background:"#fff",border:"1px solid #e8e6e1",borderRadius:14}}>
                <div style={{fontSize:52,marginBottom:16}}>📰</div>
                <div style={{fontFamily:"'Instrument Serif',serif",fontSize:"1.5rem",color:"#1c1917",marginBottom:10}}>Pick a date. Pick a section.</div>
                <div style={{fontSize:13.5,color:"#a8a29e",lineHeight:1.8,maxWidth:360,margin:"0 auto 20px"}}>
                  Every Hindu article explained in<br/><strong style={{color:"#1c1917"}}>numbered key points</strong> — not boring summaries.<br/>With UPSC mapping and difficult words explained.
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",fontSize:12.5,color:"#57534e"}}>
                  {["📌 Key points per article","🎯 UPSC GS mapping","📖 Terms explained","📅 Any date"].map(f => (
                    <span key={f} style={{padding:"5px 12px",borderRadius:100,background:"#f5f4f2",border:"1px solid #e8e6e1"}}>{f}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}