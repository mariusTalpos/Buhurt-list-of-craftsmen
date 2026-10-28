// Read-only production checks plus one deliberately invalid bot token.
// Does not create reviews, upload files, or read private contact data.
import assert from 'node:assert/strict';
import { reviewConfig as config } from '../public-config.production.js';
const site='https://mariustalpos.github.io/Buhurt-list-of-craftsmen/';
const origin=new URL(site).origin;
for(const path of ['','moderation.html','public-config.production.js','assets/reviews/review-form.js','assets/reviews/public-reviews.js','assets/reviews/moderation.js','assets/photos/photo-worker.js','assets/photos/heif-decoder.js']){
  const response=await fetch(new URL(path,site),{method:'HEAD',cache:'no-store'});assert.equal(response.status,200,path);
}
for(const path of ['public-config.js','.local/review-preview.json']){
  const response=await fetch(new URL(path,site),{method:'HEAD',cache:'no-store'});assert.equal(response.status,404,'Private file exposed: '+path);
}
const deployed=await(await fetch(new URL('public-config.production.js',site),{cache:'no-store'})).text();
assert.match(deployed,/reviewsEnabled: true/);assert.match(deployed,/submissionEnabled: true/);assert.ok(deployed.includes(config.turnstileSiteKey));assert.ok(!deployed.includes('previewToken:'));
const headers={Origin:origin,apikey:config.supabasePublishableKey};
const summaryResponse=await fetch(`${config.supabaseUrl}/functions/v1/review-public?action=summaries`,{headers});assert.equal(summaryResponse.status,200);
assert.match(summaryResponse.headers.get('cache-control'),/no-store/);const summaries=await summaryResponse.json();assert.ok(Array.isArray(summaries.summaries));
const listResponse=await fetch(`${config.supabaseUrl}/functions/v1/review-public?action=list&vendor_id=1`,{headers});assert.equal(listResponse.status,200);
const list=await listResponse.json();const publicFields=['id','vendor_id','display_name','product_service','experience','published_at','quality','value_for_money','responsiveness','production_speed','photos'];
for(const row of list.reviews)assert.ok(Object.keys(row).every(key=>publicFields.includes(key)));
const raw=await fetch(`${config.supabaseUrl}/rest/v1/reviews?select=*`,{headers});assert.ok([401,403].includes(raw.status),'Anonymous raw review access must be denied.');
const moderation=await fetch(`${config.supabaseUrl}/functions/v1/review-moderate?action=list&status=pending`,{headers});assert.equal(moderation.status,401);
const invalidBot=await fetch(`${config.supabaseUrl}/functions/v1/review-submit?action=start`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({
  review:{vendor_id:'1',display_name:'Pilot configuration check',product_service:'Synthetic check',experience:'Invalid bot token must never save this review.',quality:5,value_for_money:4,responsiveness:3,production_speed:4,contact_name:'Synthetic check',contact_method:'email',contact_details:'pilot@example.invalid',photos_public:false,confirmed:true,website:''},
  photos:[{size:1,sha256:'0'.repeat(64)}],challenge:'XXXX.DUMMY.TOKEN.XXXX'
})});
assert.equal(invalidBot.status,400);assert.match((await invalidBot.json()).error,/Bot check failed/);
console.log(JSON.stringify({passed:true,site,publishedVendorCount:summaries.summaries.length,checks:['static assets','production flags/key','no private files','public reads','private API denial','real secret rejects dummy token'],remaining:'A real human challenge/submission and physical-phone acceptance.'}));
