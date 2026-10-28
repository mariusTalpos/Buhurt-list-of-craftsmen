import test from 'node:test';
import assert from 'node:assert/strict';
import { lifecycle, reviewData } from './helpers/review-lifecycle.mjs';
import { editFields } from './helpers/moderation-store.mjs';
import { publicReview, summarizeReviews } from '../supabase/functions/_shared/public-review-policy.js';
import { createPublicReviewHandler } from '../supabase/functions/review-public/handler.js';
import { PublicReviewClient } from '../src/reviews/public-client.js';

test('complete submission to moderation lifecycle changes public counts and unrounded averages', async () => {
  const s = await lifecycle(); const first = await s.submit(), second = await s.submit(reviewData([3,2,5,2], false));
  assert.deepEqual((await (await s.read('summaries')).json()).summaries, []);
  assert.equal((await s.read('get', { id: first })).status, 404);
  assert.equal((await s.mutate('approve', first)).status, 200); assert.equal((await s.mutate('approve', second)).status, 200);
  let summary = (await (await s.read('summaries')).json()).summaries[0];
  assert.deepEqual(summary, { vendor_id:'1',count:2,overall:3.5,quality:4,value_for_money:3,responsiveness:4,production_speed:3 });
  const row = s.rows.get(first);
  assert.equal((await s.mutate('edit', first, { changes: editFields(row, { quality: 1, experience: 'An agreed correction.' }) })).status, 200);
  summary = (await (await s.read('summaries')).json()).summaries[0]; assert.equal(summary.count, 2); assert.equal(summary.overall, 3);
  assert.equal((await s.mutate('unpublish', first)).status, 200);
  summary = (await (await s.read('summaries')).json()).summaries[0]; assert.equal(summary.count, 1); assert.equal(summary.overall, 3);
  assert.equal((await s.mutate('delete', first, { confirm: true })).status, 200);
  assert.equal((await s.read('photo', { id:first,index:'0' })).status, 404);
  await s.mutate('delete', second, { confirm: true });
  assert.deepEqual((await (await s.read('summaries')).json()).summaries, []); assert.equal(s.photos.size, 0);
});
test('public fields are explicitly allowlisted and photos recheck permission, exclusion, and publication', async () => {
  const s = await lifecycle(); const id = await s.submit(); const privateId = await s.submit(reviewData([3,2,5,2], false));
  await s.mutate('approve', id); await s.mutate('approve', privateId);
  const response = await s.read('list', { vendor_id:'1' }); const payload = await response.json(); const serialized = JSON.stringify(payload);
  for (const privateValue of ['contact_name','contact_method','contact_details','owner_note','photo_paths','photos_public','excluded_photo_paths','private@example.invalid','Private synthetic name']) assert.ok(!serialized.includes(privateValue), privateValue);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(payload.reviews.find(row => row.id === privateId).photos, []);
  assert.equal((await s.read('photo',{id:privateId,index:'0'})).status,404);
  assert.equal((await s.read('photo',{id,index:'0'})).status,200);
  const row = s.rows.get(id); await s.mutate('edit', id, { changes:editFields(row,{excluded_photo_paths:row.photo_paths}) });
  assert.equal((await s.read('photo',{id,index:'0'})).status,404);
  await s.mutate('unpublish', id); assert.equal((await s.read('get',{id})).status,404);
  assert.equal(publicReview(s.rows.get(id)),null);
});
test('review pages are bounded and links can retrieve an older published review directly', async () => {
  const s = await lifecycle(); const id = await s.submit(); await s.mutate('approve',id); const base = s.rows.get(id);
  for(let n=0;n<24;n++){const key=crypto.randomUUID();s.rows.set(key,{...base,id:key,published_at:new Date(Date.now()+n*1000).toISOString()});}
  const first=await(await s.read('list',{vendor_id:'1'})).json(); assert.equal(first.reviews.length,20);assert.equal(first.has_more,true);
  const second=await(await s.read('list',{vendor_id:'1',offset:'20'})).json();assert.equal(second.reviews.length,5);assert.equal(second.has_more,false);
  assert.equal(new Set([...first.reviews,...second.reviews].map(row=>row.id)).size,25);
  assert.equal((await s.read('get',{id:second.reviews[4].id})).status,200);
  assert.equal((await s.read('list',{vendor_id:'not-a-vendor'})).status,400);
  assert.equal((await s.read('list',{vendor_id:'1',offset:'-1'})).status,400);
});
test('preview stays closed; enabled public reads need no Auth account and reject writes/bad origins',async()=>{
  const s=await lifecycle();assert.equal((await s.read('summaries',{},false)).status,404);
  const open=createPublicReviewHandler({store:s.publicStore,vendorIds:new Set(['1']),allowedOrigins:['http://localhost:8000'],publicEnabled:true});
  const result=await open(new Request('https://example.invalid?action=summaries'));assert.equal(result.status,200);
  assert.equal((await open(new Request('https://example.invalid?action=summaries',{method:'POST'}))).status,405);
  assert.equal((await open(new Request('https://example.invalid?action=summaries',{headers:{Origin:'https://evil.invalid'}}))).status,403);
});
test('summary calculations do not round individual review scores and ignore pending rows',()=>{
  const make=(q,status='published')=>({vendor_id:'1',status,quality:q,value_for_money:1,responsiveness:1,production_speed:1});
  assert.equal(summarizeReviews([make(2),make(3),make(5,'pending')])[0].overall,1.375);
  assert.deepEqual(summarizeReviews([]),[]);
});
test('service failures return no data or false empty state and browser client reports unavailable',async()=>{
  const handler=createPublicReviewHandler({store:{async ratings(){throw Error('private backend diagnostic');}},vendorIds:new Set(['1']),allowedOrigins:[],publicEnabled:true});
  const response=await handler(new Request('https://example.invalid?action=summaries'));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private backend diagnostic'));
  const client=new PublicReviewClient({supabaseUrl:'https://example.invalid',supabasePublishableKey:'public'},async()=>{throw TypeError('Failed to fetch');});
  await assert.rejects(client.request('summaries'),/Reviews temporarily unavailable/);
});
