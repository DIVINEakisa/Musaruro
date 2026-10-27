/* Nyabihu potato cold-storage snapshot: featured entry, keyboard view sequence and local human-review forms.
 * The view sequence has no on-screen controls unless the page is opened with ?presenter=1. No remote fetches. */
(function(root){
  'use strict';
  let api, bundle, step=-1;
  // On-screen view controls only for rehearsal (?presenter=1); otherwise the sequence is keyboard/clicker only.
  const presenter=new URLSearchParams(root.location?.search||'').get('presenter')==='1';
  const V=root.EnaHeroVerification;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const steps=[
    {title:'Harvest',lens:'harvest',caption:'ESTIMATED: district potato production is allocated through mapped buildings and road catchments.'},
    {title:'Where first',lens:'first',caption:'ESTIMATED: the shortlist orders places to investigate for potato cold storage.'},
    {title:'Rank-1 card',lens:'first',caption:'ESTIMATED: follow each number to its assumptions; a mapped market does not prove a cold room.'},
    {title:'How sure',lens:'sure',caption:'ESTIMATED: the same 300 draws show stability and energy sensitivity, not field accuracy.'},
    {title:'Rain vs dry',lens:'access',season:'rainy',caption:'ASSUMED access scenarios: rain changes travel speeds, catchments and sometimes ranks.'},
    {title:'Likely sites',lens:'likely',caption:'PREDICTED: look-alikes are questions for humans. The siting score does not change the energy ranking.'}
  ];
  function records(){try{return JSON.parse(localStorage.getItem('enagis-hero-verification-v1')||'{"desk":[],"phone":[]}');}catch{return {desk:[],phone:[]};}}
  function saveRecords(r){localStorage.setItem('enagis-hero-verification-v1',JSON.stringify(r));}
  function download(name,text,type='text/csv'){const a=document.createElement('a');const u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  function introHTML(){return `<div class="hero-intro"><p class="eyebrow">Featured analysis · Rwanda</p><button id="hero-replay" class="primary">Nyabihu · Irish potato cold storage</button><p class="meta">Dated open-data snapshot · reproducible ranking · opens without internet</p></div>`;}
  async function load(){
    if(bundle)return bundle;
    const packed=root.ENA_HERO_BUNDLE;if(!packed)throw new Error('The Nyabihu snapshot is not included in this build.');
    const bytes=Uint8Array.from(atob(packed.data),c=>c.charCodeAt(0));
    const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==packed.sha256)throw new Error('The snapshot checksum did not match, so it was not opened.');
    bundle=JSON.parse(new TextDecoder().decode(raw));return bundle;
  }
  async function replay(guided){
    try { const b=await load();step=-1;await api.replay(b);if(guided)navigate(0);else render(); }
    catch(e){api.openPanel(`<h2>Snapshot unavailable</h2><p>${esc(e.message)}</p>`);}
  }
  function navigate(n){
    step=Math.max(0,Math.min(steps.length-1,n));const s=steps[step];
    api.closePanel();api.navigate({lens:s.lens,season:s.season||'dry',card:step>=2,candidate:step===5});render();
  }
  function render(){
    const state=api.state(),bar=document.getElementById('hero-stepper');
    document.body.dataset.heroStep=state.hero?String(step):'';
    bar.hidden=!state.hero||!presenter;
    if(!state.hero){step=-1;document.body.classList.remove('hero-mode');bar.innerHTML='';return;}
    document.body.classList.add('hero-mode');
    if(presenter)bar.innerHTML=`<div class="hero-step-controls">${steps.map((s,i)=>`<button data-hero-step="${i}" aria-current="${i===step?'step':'false'}" title="${esc(s.title)}">${i+1}<span> ${esc(s.title)}</span></button>`).join('')}<button id="hero-exit">${step<0?'Start':'Free view'}</button></div><p id="hero-caption" aria-live="polite">${step<0?'Free view. Page Down or → moves to the next view.':esc(steps[step].caption)}</p>`;
    const foot=document.querySelector('#drawer .drawer-foot');
    if(foot&&!foot.querySelector('#hero-provenance'))foot.insertAdjacentHTML('beforeend','<button id="hero-provenance">Provenance</button><button id="hero-why">Why Nyabihu</button><button id="hero-sensitivity">Sensitivity</button><button id="hero-checks">Verification</button>');
  }
  function assumptions(id){
    const rows=bundle.assumptions.rows;
    api.openPanel(`<h2>Assumptions</h2><p class="meta">Nyabihu potato cold storage · values used in this snapshot. ASSUMED means the exact range is unsupported by the reviewed sources. Scientific parameter approval remains pending.</p><button id="hero-edit-assumptions">Edit exploratory assumptions</button>${rows.map(r=>`<section class="card assumption-row" id="assumption-${esc(r.id)}" tabindex="-1"><h3>${esc(r.title)}</h3><p><strong>${esc(typeof r.value==='object'?JSON.stringify(r.value):r.value)}</strong> ${esc(r.unit)} · <span class="status-chip">${esc(r.label)}</span></p><p class="meta">Range: ${esc(r.range===null?'not applicable':JSON.stringify(r.range))}</p><p>${esc(r.why)}</p><p class="meta">${r.source?`<a href="${esc(r.source)}" target="_blank" rel="noopener">Source</a> · ${esc(r.year||'publication year unknown')}`:'No supporting source found for this value.'}</p></section>`).join('')}`);
    if(id){const row=document.getElementById('assumption-'+id);if(row){row.scrollIntoView({block:'start'});row.focus({preventScroll:true});}}
  }
  function provenance(){
    const m=bundle.manifest;
    api.openPanel(`<h2>Provenance</h2><p>Dated snapshot · opens without internet · <span class="status-chip">ESTIMATED outputs</span></p><div class="card"><p>Engine ${esc(m.engine_version)}</p><p>Overture release ${esc(m.release)}</p><p>Retrieved ${esc(m.frozen_at)}</p><p>Seed ${m.seed} · ${m.draws} draws</p><p>${esc(m.crs)} · longitude, latitude</p></div>${m.sources.map(s=>`<div class="card"><strong>${esc(s.label)}</strong><p class="meta">${esc(s.retrieved_at)} · ${esc(s.licence)}</p><p class="hash">${esc(s.endpoint)}</p></div>`).join('')}<h3>File SHA-256</h3>${m.files.map(f=>`<details><summary>${esc(f.path.replace(/^data\/rwanda\/hero\//,''))}</summary><p class="hash">${esc(f.sha256)}</p><p>${f.bytes} bytes</p></details>`).join('')}<p class="meta">Source dates differ. Release dates are not imagery dates. Newer releases exist for some sources; they are listed as references and are not mixed into this snapshot.</p>`);
  }
  function why(){const r=api.state().result,c=bundle.context;api.openPanel(`<h2>Why Nyabihu potato cold storage?</h2><div class="hero-fact"><strong>${Math.round(r.meta.per_capita.t*1000)} vs ${Math.round(r.meta.per_capita.evidence.national_kg)}</strong><span>kg potato/person/year · ESTIMATED district vs national, 2024 production / 2022 census</span></div><div class="hero-fact"><strong>${(c.footprints/1e6).toFixed(1)} million</strong><span>building footprints in the national harvest · DOCUMENTED dataset count</span></div><div class="hero-fact"><strong>${c.documented}</strong><span>documented agricultural facility records nationally · DOCUMENTED; not all are cold rooms</span></div><p>Footprints reveal settlement structure, while documented facility records are sparse. These counts use different units and do not measure a storage-capacity gap.</p><p>We infer technical demand and a visit shortlist because open imagery does not establish whether a roof contains refrigeration. The same engine remains available for all districts and four chains.</p><p class="meta">No field visits (n = 0). Imagery and phone checks remain human work.</p>`);}
  function sensitivity(){
    const r=bundle.report,rows=r.variance.rows,checks=r.ranking_sensitivity.checks;
    const flips=checks.filter(c=>c.rank>10),names=id=>bundle.targets.find(t=>t.id===id)?.name||id;
    const label=k=>bundle.assumptions.rows.find(a=>a.id===k)?.title||k;
    const energy=api.state().result.sites.find(s=>s.id===r.site_id).dry.kwh_day;
    api.openPanel(`<h2>Rank-1 sensitivity</h2><p>ESTIMATED: ${energy.p5.toFixed(0)}–${energy.p95.toFixed(0)} kWh/day from the existing ${r.draws} draws.</p><p class="meta">${esc(r.method)}. ${esc(r.caveat)}</p><div class="hero-tornado" aria-label="Sample variance contributions">${rows.map(x=>`<div class="hero-driver"><button data-assumption="${esc(x.key)}">${esc(label(x.key))}</button><meter min="0" max="1" value="${x.fraction}"></meter><span>${(x.fraction*100).toFixed(1)}%</span></div>`).join('')}<p>Residual / nonlinear effects: ${(r.variance.residual*100).toFixed(1)}%. Contributions plus residual: 100%.</p></div><h3>What would change the ranking?</h3><p class="meta">${esc(r.ranking_sensitivity.method)}</p>${flips.length?`<ul>${flips.slice(0,9).map(c=>`<li>${esc(names(c.site_id))}: ${esc(label(c.key))} at ${Number(c.value).toPrecision(3)} moves to rank ${c.rank} (ESTIMATED).</li>`).join('')}</ul>`:'<p>No tested single assumption pushes a central top-3 site outside the top 10. It would be misleading to name two or three that do.</p>'}<h3>Joint-draw departures</h3>${r.rank_exits.map(s=>`<p>${esc(s.name)}: outside the top 10 in ${s.outside_top10} of ${r.draws} draws (ESTIMATED).</p>`).join('')}<p class="meta">Joint departures cannot be assigned to one assumption. Rain is a separate fixed scenario, not a sampled tornado parameter.</p>`);
  }
  function badges(target){const c=V.counts(target,records(),bundle.protocol);return `<div class="hero-evidence"><p>DOCUMENTED ${c.documented} · PREDICTED ${c.predicted}<br>DESK-CHECKED ${c.desk} · PHONE-CHECKED ${c.phone}</p><p class="meta">${c.attempts} call attempts · ${c.confirmed} confirmed activity · ${c.rejected} rejected · ${c.inconclusive} inconclusive. Imagery and phone checks are not field validation; field visits 0.</p></div>`;}
  function decorate(){
    if(!api.state().hero||!bundle)return;
    const state=api.state(),el=document.getElementById('sheet'),target=bundle.targets.find(t=>t.id===(state.cand?'lookalike-'+state.cand:state.selected));
    if(target&&!el.querySelector('.hero-evidence'))el.querySelector('.sheet-scroll')?.insertAdjacentHTML('beforeend',badges(target));
    // Attach every numeric text token on the hero card to its relevant evidence/assumption row.
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode()){
      const n=walker.currentNode;if(/\d/.test(n.textContent)&&!n.parentElement.closest('button,a,h2'))nodes.push(n);
    }
    for(const n of nodes){
      const block=n.parentElement.closest('.block'),heading=block?.querySelector('h3')?.textContent||'';
      let key=heading==='How sure'?'ranking':heading==='Siting model'?'siting':heading==='Energy options'?'solar':heading==='Why it is here'?'energy':'location';
      const context=n.parentElement.closest('p')?.textContent||'';
      if(/people|minutes|growing/.test(context))key='people';if(/throughput|in store/.test(context))key='energy';
      if(/minutes/.test(n.textContent))key='max_travel_min';
      if(/growing/.test(context)&&n.parentElement.tagName==='STRONG'&&n.parentElement===n.parentElement.closest('p').querySelectorAll('strong')[1])key='production';
      if(/power line|mapped grid|generator/.test(context))key='location';
      if(n.parentElement.closest('.eyebrow'))key='ranking';
      if(n.parentElement.closest('.hero-evidence'))key='verification';
      const frag=document.createDocumentFragment();let pos=0;
      for(const m of n.textContent.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)){frag.append(n.textContent.slice(pos,m.index));const b=document.createElement('button');b.className='number-ref';b.dataset.assumption=key;b.textContent=m[0];b.title='Evidence and assumptions: '+key;frag.append(b);pos=m.index+m[0].length;}
      frag.append(n.textContent.slice(pos));n.replaceWith(frag);
    }
  }
  function checks(){
    const select=bundle.targets.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const recordsNow=records(),desk=recordsNow.desk.filter(V.validateDesk),phone=recordsNow.phone.filter(r=>V.validatePhone(r,bundle.protocol));
    api.openPanel(`<h2>Verification</h2><p>${desk.length} completed imagery reviews; ${phone.length} call attempts; ${phone.filter(r=>r.status==='completed').length} completed calls. Field visits 0.</p><p class="meta">Reviewers record their own judgments. Store reviewer aliases and anonymised outcomes only. Private contacts and raw notes belong outside public outputs.</p><label>Site<select id="hero-target">${select}</select></label><p><a id="hero-imagery" target="_blank" rel="noopener">Open satellite imagery</a></p><div class="actions"><button data-hero-form="desk">Record imagery review</button><button data-hero-form="phone">Record phone outcome</button><button id="hero-export-desk">Export desk CSV</button><button id="hero-export-phone">Export phone CSV</button></div><div id="hero-form"></div><p class="hash">Approved activity-only protocol SHA-256: ${bundle.protocol.sha256}</p><p class="meta">Printable per-site call sheets and CSV templates accompany this snapshot. A source image does not establish refrigeration or a working power connection.</p>`);
    document.getElementById('hero-target').onchange=updateImagery;updateImagery();
    const holder=document.createElement('label');holder.textContent='Import reviewed CSV (local only)';
    const upload=document.createElement('input');upload.type='file';upload.accept='.csv,text/csv';upload.multiple=true;upload.id='hero-import';holder.append(upload);document.getElementById('hero-form').before(holder);
    upload.onchange=async()=>{
      try{const all=records();for(const file of upload.files){const parsed=V.parseCSV(await file.text());const kind=parsed.header.includes('protocol_sha256')?'phone':'desk';
        const cols=kind==='desk'?V.DESK:V.PHONE;if(JSON.stringify(cols)!==JSON.stringify(parsed.header))throw new Error('Unexpected CSV schema');
        for(const row of parsed.rows){if(!bundle.targets.some(t=>t.id===row.site_id)||!(kind==='desk'?V.validateDesk(row):V.validatePhone(row,bundle.protocol)))throw new Error('Incomplete, inconsistent or unknown-target row; no files imported');
          const key=r=>[r.site_id,r.reviewer,r.checked_at].join('|');const old=all[kind].find(r=>key(r)===key(row));
          if(old&&JSON.stringify(old)!==JSON.stringify(row))throw new Error('Conflicting duplicate review');if(!old)all[kind].push(row);
        }}saveRecords(all);api.refresh();checks();
      }catch(e){document.getElementById('hero-form').textContent='Import failed: '+e.message;}
    };
  }
  function updateImagery(){const s=bundle.targets.find(t=>t.id===document.getElementById('hero-target').value);document.getElementById('hero-imagery').href=`https://www.google.com/maps/@${s.lat},${s.lon},300m/data=!3m1!1e3`;}
  function form(kind){
    const input=(id,label,type='text')=>`<label>${label}<input name="${id}" type="${type}" ${type==='number'?'min="0" step="any"':''}></label>`;
    const yn=(id,label)=>`<label>${label}<select name="${id}"><option value="unclear">unclear</option><option value="yes">yes</option><option value="no">no</option></select></label>`;
    document.getElementById('hero-form').innerHTML=`<form id="hero-review-form" data-kind="${kind}"><h3>${kind==='desk'?'Imagery review — not field validation':'Phone outcome — activity only'}</h3>${input('reviewer','Reviewer alias')}${input('checked_at','Observation time (UTC ISO, e.g. 2026-10-10T17:00:00Z)')}${kind==='desk'?`${input('imagery_url','Imagery URL','url')}${input('imagery_date','Imagery date (or UNKNOWN)')}${yn('building_present','Building present')}${input('roof_area_m2','Approximate roof area m² (blank if unknown)','number')}${yn('road_access','Road access')}${yn('visible_power_line','Visible power line')}${yn('plausible_site','Plausible collection/storage site')}${input('notes','Non-personal note')}`:`<label>Status<select name="status"><option value="attempt">Attempt / no completed response</option><option value="completed">Completed response</option></select></label>${yn('consent','Consent to log anonymised response')}${yn('direct_knowledge','Direct operational knowledge')}${yn('exact_site','Exact site established')}${input('season','Most recent completed season (name/year)')}${yn('potato_activity','Potato aggregation or storage')}${input('tonnes','Reported tonnes (blank if unknown)','number')}`}<button type="submit" class="primary">Save local review</button><p id="hero-form-status" role="status"></p></form>`;
    const f=document.getElementById('hero-review-form');f.elements.checked_at.value=new Date().toISOString();
    if(kind==='desk'){f.elements.imagery_url.value=document.getElementById('hero-imagery').href;f.elements.imagery_date.value='UNKNOWN';}
    f.onsubmit=e=>{e.preventDefault();const r=Object.fromEntries(new FormData(f));r.site_id=document.getElementById('hero-target').value;
      if(kind==='phone'){r.protocol_sha256=bundle.protocol.sha256;r.outcome=V.outcome(r);}
      const valid=kind==='desk'?V.validateDesk(r):V.validatePhone(r,bundle.protocol);
      if(!valid){document.getElementById('hero-form-status').textContent='Incomplete or inconsistent review. Add reviewer, date and required source details; phone date must follow the protocol freeze.';return;}
      try{const all=records();all[kind].push(r);saveRecords(all);api.refresh();checks();}catch(e){document.getElementById('hero-form-status').textContent='Could not save local record: '+e.message;}
    };
  }
  function init(app){api=app;
    document.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
      if(t.id==='hero-start')replay(true);else if(t.id==='hero-replay')replay(false);
      else if(t.dataset.heroStep!==undefined)navigate(+t.dataset.heroStep);
      else if(t.id==='hero-exit'){if(step<0)navigate(0);else{step=-1;render();}}
      else if(t.id==='hero-provenance')provenance();else if(t.id==='hero-why')why();else if(t.id==='hero-sensitivity')sensitivity();
      else if(t.dataset.assumption)assumptions(t.dataset.assumption);else if(t.id==='hero-checks')checks();
      else if(t.dataset.heroForm)form(t.dataset.heroForm);else if(t.id==='hero-edit-assumptions')api.editAssumptions();
      else if(t.id==='hero-export-desk')download('desk-check.csv',V.csv(V.DESK,records().desk));
      else if(t.id==='hero-export-phone')download('phone-log.csv',V.csv(V.PHONE,records().phone));
    });
    // Presenter sequence: Page Down/Up (presentation clickers) or arrow keys while the snapshot is open. Arrow keys are left
    // to the map when it has focus; nothing about the sequence is shown on screen.
    document.addEventListener('keydown',e=>{if(!api.state().hero||api.state().phase!=='results'||!document.getElementById('panel').hidden||e.target.closest('input,textarea,select')||e.target.closest('#swipe'))return;
      const next=e.key==='PageDown'||(e.key==='ArrowRight'&&!e.target.closest('.maplibregl-canvas'));
      const prev=e.key==='PageUp'||(e.key==='ArrowLeft'&&!e.target.closest('.maplibregl-canvas'));
      if(next||prev){e.preventDefault();navigate(step<0?0:step+(next?1:-1));}
      else if(e.key==='Escape'&&step>=0){step=-1;render();}
    });render();
  }
  root.EnaHeroUI={init,introHTML,render,decorate,assumptions,steps,replay,go:navigate,leave:()=>{step=-1;render();}};
})(window);
