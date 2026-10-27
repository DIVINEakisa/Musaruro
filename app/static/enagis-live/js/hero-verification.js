(function(root) {
  'use strict';
  const DESK = ['site_id','reviewer','checked_at','imagery_url','imagery_date','building_present','roof_area_m2','road_access','visible_power_line','plausible_site','notes'];
  const PHONE = ['site_id','reviewer','checked_at','protocol_sha256','status','consent','direct_knowledge','exact_site','season','potato_activity','tonnes','outcome'];
  const ynu = v => ['yes','no','unclear'].includes(v);
  function validateDesk(r) {
    if (!r.site_id || !r.reviewer || !Number.isFinite(Date.parse(r.checked_at)) || !/^https:\/\//.test(r.imagery_url || '') || !r.imagery_date) return false;
    return ['building_present','road_access','visible_power_line','plausible_site'].every(k => ynu(r[k])) &&
      (r.roof_area_m2 === '' || (Number.isFinite(+r.roof_area_m2) && +r.roof_area_m2 >= 0));
  }
  function outcome(r) {
    if (r.status === 'attempt') return 'ATTEMPT';
    if (r.status !== 'completed' || r.consent !== 'yes' || r.direct_knowledge !== 'yes' || r.exact_site !== 'yes' || !r.season.trim()) return 'INCONCLUSIVE';
    if (r.potato_activity === 'no' || (r.tonnes !== '' && +r.tonnes === 0)) return 'REJECTED_ACTIVITY';
    if (r.potato_activity === 'yes' && r.tonnes !== '' && Number.isFinite(+r.tonnes) && +r.tonnes > 0) return 'CONFIRMED_ACTIVITY';
    return 'INCONCLUSIVE';
  }
  function validatePhone(r, protocol) {
    return !!(r.site_id && r.reviewer && ['attempt','completed'].includes(r.status) &&
      ['consent','direct_knowledge','exact_site','potato_activity'].every(k => ynu(r[k])) &&
      Number.isFinite(Date.parse(r.checked_at)) && Date.parse(r.checked_at) >= Date.parse(protocol.frozen_at) &&
      r.protocol_sha256 === protocol.sha256 && (r.tonnes === '' || (Number.isFinite(+r.tonnes) && +r.tonnes >= 0)) && r.outcome === outcome(r));
  }
  function counts(site, records, protocol) {
    const desk = records.desk.filter(r => r.site_id === site.id && validateDesk(r));
    const phone = records.phone.filter(r => r.site_id === site.id && validatePhone(r, protocol));
    return {documented:site.documented ? 1 : 0, predicted:site.predicted ? 1 : 0, desk:desk.length,
      phone:phone.filter(r => r.status === 'completed').length, attempts:phone.length,
      confirmed:phone.filter(r => r.outcome === 'CONFIRMED_ACTIVITY').length,
      rejected:phone.filter(r => r.outcome === 'REJECTED_ACTIVITY').length,
      inconclusive:phone.filter(r => r.status === 'completed' && r.outcome === 'INCONCLUSIVE').length};
  }
  function csv(cols, records) {
    const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return cols.join(',') + '\n' + records.map(r => cols.map(k => cell(r[k])).join(',')).join('\n') + (records.length ? '\n' : '');
  }
  function parseCSV(text) {
    const rows=[];let row=[],value='',quoted=false;
    text=text.replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++) {const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
      else if(c===','&&!quoted){row.push(value);value='';}
      else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];value='';}
      else value+=c;
    }
    if(quoted)throw new Error('Unclosed CSV quote');
    if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}
    const header=rows.shift();if(!header)return {header:[],rows:[]};
    if(new Set(header).size!==header.length)throw new Error('Duplicate CSV columns');
    return {header,rows:rows.map(r=>{if(r.length!==header.length)throw new Error('CSV row has wrong column count');return Object.fromEntries(header.map((k,i)=>[k,r[i]]));})};
  }
  const api = {DESK,PHONE,validateDesk,validatePhone,outcome,counts,csv,parseCSV}; root.EnaHeroVerification = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
