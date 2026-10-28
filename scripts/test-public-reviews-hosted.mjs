// Staged private-preview integration check. Synthetic fixture permits stay in .local.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { SubmissionClient } from '../src/reviews/submission-client.js';
import { PublicReviewClient } from '../src/reviews/public-client.js';
import { sha256 } from '../supabase/functions/review-submit/handler.js';
const config=JSON.parse(await readFile('.local/review-preview.json','utf8'));
const fetcher=(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:'http://localhost:8000'}});
const pub=new PublicReviewClient(config,fetcher),fixtureFile='.local/public-review-fixtures.json';
const mode=process.argv[2]??'check-pending';
if(mode==='prepare'){
  try{const existing=JSON.parse(await readFile(fixtureFile,'utf8'));console.log(JSON.stringify({existing:true,ids:existing.map(item=>item.id)}));process.exit(0);}catch(error){if(error.code!=='ENOENT')throw error;}
  const fixtures=[];
  const bytes=jpeg.encode({width:32,height:48,data:new Uint8Array(32*48*4).fill(180)},90).data;
  for(const [index,stars] of [[5,4,3,4],[3,2,5,2]].entries()){
    const review={vendor_id:'1',display_name:`Phase 4 test ${index+1}`,product_service:'Synthetic test gauntlets',experience:'Synthetic Phase 4 integration fixture. No real reviewer or purchase.',
      contact_name:'Synthetic private contact',contact_method:'email',contact_details:'phase4@example.invalid',quality:stars[0],value_for_money:stars[1],responsiveness:stars[2],production_speed:stars[3],photos_public:index===0,confirmed:true,website:''};
    const client=new SubmissionClient(config,fetcher);
    const attempt=await client.request('start',{body:{review,photos:[{size:bytes.length,sha256:await sha256(bytes)}],challenge:'XXXX.DUMMY.TOKEN.XXXX'}});
    await client.request('photo',{permit:attempt.permit,index:0,body:new Blob([bytes],{type:'image/jpeg'})});
    const result=await client.request('finish',{permit:attempt.permit});fixtures.push({id:result.reference,permit:attempt.permit});
    await writeFile(fixtureFile,JSON.stringify(fixtures));
  }
  console.log(JSON.stringify({created:fixtures.length,ids:fixtures.map(item=>item.id)}));
}else{
  const fixtures=JSON.parse(await readFile(fixtureFile,'utf8'));
  if(mode==='cleanup-files'){
    for(const item of fixtures){const client=new SubmissionClient(config,fetcher);const result=await client.request('cancel',{permit:item.permit});assert.equal(result.cancelled,true,'Remove only the identified synthetic rows before file cleanup.');}
    await unlink(fixtureFile);console.log('Synthetic fixture files removed through the authenticated submission permits.');
  }else{
    const gate=await fetcher(`${config.supabaseUrl}/functions/v1/review-public?action=summaries`,{headers:{apikey:config.supabasePublishableKey}});assert.equal(gate.status,404);
    const data=await pub.request('summaries'),summary=data.summaries.find(item=>item.vendor_id==='1');
    if(mode==='check-pending'||mode==='check-empty')assert.equal(summary,undefined);
    else{assert.equal(summary.count,mode==='check-withdrawn'?1:2);assert.equal(summary.overall,mode==='check-published'?3.5:3);}
    for(const [index,item] of fixtures.entries()){
      const shouldExist=mode==='check-published'||mode==='check-edited'||(mode==='check-withdrawn'&&index===1);
      if(!shouldExist){await assert.rejects(pub.request('get',{id:item.id}),/unavailable/);await assert.rejects(pub.request('photo',{id:item.id,index:'0'}),/unavailable/);continue;}
      const response=await pub.request('get',{id:item.id});const text=JSON.stringify(response);
      for(const secret of ['contact_name','contact_details','contact_method','owner_note','photo_paths','excluded_photo_paths','phase4@example.invalid'])assert.ok(!text.includes(secret),secret);
      assert.deepEqual(response.review.photos,index===0?[0]:[]);
      if(index===0){const photo=await pub.request('photo',{id:item.id,index:'0'});assert.ok(photo.size>0);}
      else await assert.rejects(pub.request('photo',{id:item.id,index:'0'}),/unavailable/);
    }
    console.log(`PASS: hosted ${mode}, preview gate, public-field allowlist, and current photo permissions.`);
  }
}
