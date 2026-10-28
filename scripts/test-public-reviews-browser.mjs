import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { prototypeServer } from './serve-prototype.mjs';
import { lifecycle, reviewData } from '../tests/helpers/review-lifecycle.mjs';
import { editFields } from '../tests/helpers/moderation-store.mjs';
const basePath = '/Buhurt-list-of-craftsmen/';
const server = prototypeServer({ basePath }); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`, home = origin + basePath;
const s = await lifecycle(origin); let outage = false, slow = true, photoRequests = 0;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport:{width:390,height:844}, permissions:['clipboard-read','clipboard-write'] });
await context.route('**/public-config.js',route=>route.fulfill({contentType:'text/javascript',body:`export const reviewConfig=${JSON.stringify(s.config)}`}));
await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>route.fulfill({contentType:'text/javascript',body:`window.turnstile={render:(el,o)=>{o.callback('XXXX.DUMMY.TOKEN.XXXX');return 1},reset:()=>{}};`}));
await context.route('https://lifecycle.invalid/**',async route=>{
  const incoming=route.request(),url=new URL(incoming.url()),action=url.searchParams.get('action');
  if (url.pathname.endsWith('review-public') && outage) return route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});
  if (url.pathname.endsWith('review-public') && action==='summaries' && slow) { slow=false; await new Promise(resolve=>setTimeout(resolve,200)); }
  if(action==='photo' && url.pathname.endsWith('review-public')) photoRequests++;
  const handler=url.pathname.endsWith('review-submit')?s.submission:s.publicHandler;
  const response=await handler(new Request(incoming.url(),{method:incoming.method(),headers:incoming.headers(),...(['GET','HEAD'].includes(incoming.method())?{}:{body:incoming.postDataBuffer()})}));
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.stack);});
page.setDefaultTimeout(10000);
const summary=page.locator('[data-review-summary="1"]');
async function refresh(){const link=page.locator('.read-reviews[href="?reviews=1"]');await link.focus();await link.press('Enter');await page.locator('.public-review-dialog').waitFor({state:'visible'});await page.locator('#public-review-status').filter({hasText:'Loading reviews'}).waitFor({state:'hidden'});}
async function close(){await page.getByRole('button',{name:'Close reviews',exact:true}).click();}
try {
  await page.goto(home);await summary.getByText('No reviews yet',{exact:true}).waitFor();
  await page.evaluate(()=>{window.reviewClickTrace=[];document.addEventListener('click',event=>{const a=event.target.closest('.read-reviews');if(a)window.reviewClickTrace.push({button:event.button,ctrl:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey,alt:event.altKey,href:a.href,before:location.href});},true);});
  assert.equal(await summary.locator('.review-overall').count(),0);
  // Submit through the real form + photo processor + submission handler, no hosted writes.
  await page.locator('.review-action[data-review-vendor="1"]').click();
  await page.getByLabel('Public display name').fill('<script>alert(1)</script> Synthetic fighter');
  await page.getByLabel('Product or service').fill('Synthetic gauntlets');
  await page.getByRole('textbox',{name:'Your experience',exact:true}).fill('A synthetic review with good workmanship and a clear discussion of the agreed lead time.');
  await page.getByLabel('Contact name',{exact:true}).fill('Private synthetic name');
  await page.getByLabel('Contact method',{exact:true}).selectOption('email');
  await page.getByLabel('Your email address',{exact:true}).fill('private@example.invalid');
  for(const [field,value] of [['quality',5],['value_for_money',4],['responsiveness',3],['production_speed',4]])await page.locator(`input[name="${field}"][value="${value}"]`).check();
  await page.locator('input[name="confirmed"]').check();await page.locator('#review-photos').setInputFiles('tests/fixtures/phone.heic');
  await page.getByText('Photos prepared locally. Nothing has been uploaded yet.',{exact:true}).waitFor();
  assert.equal(s.rows.size,0);await page.locator('#review-submit').click();await page.getByText('Your review was submitted for approval. It is not public yet.',{exact:true}).waitFor();
  const id=[...s.rows.keys()][0];assert.equal((await s.read('get',{id})).status,404);
  await page.getByRole('button',{name:'Close review form',exact:true}).click();
  await s.mutate('approve',id);const second=await s.submit(reviewData([3,2,5,2],false));await s.mutate('approve',second);
  await refresh();await summary.getByText('★ 3.5 / 5 · 2 reviews',{exact:true}).waitFor();
  await page.locator('.published-review').filter({hasText:'<script>alert(1)</script> Synthetic fighter'}).waitFor();
  assert.equal(await page.locator('.published-review script').count(),0);
  const publicText=await page.locator('.public-review-dialog').innerText();assert.ok(!publicText.includes('private@example.invalid'));assert.ok(!publicText.includes('Private synthetic name'));
  assert.equal(photoRequests,0);await page.getByRole('button',{name:'Show 1 photo',exact:true}).click();
  await page.getByRole('img',{name:'Synthetic gauntlets — review photo 1',exact:true}).waitFor();assert.equal(photoRequests,1);
  await page.getByRole('img',{name:'Synthetic gauntlets — review photo 1',exact:true}).scrollIntoViewIfNeeded();
  await mkdir('test-results/public-reviews',{recursive:true});await page.screenshot({path:'test-results/public-reviews/mobile-photo.png'});
  assert.equal(await page.locator('.public-review-dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await page.getByRole('button',{name:'Close reviews',exact:true}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('id'),'refresh-public-reviews');
  await mkdir('test-results/public-reviews',{recursive:true});await page.screenshot({path:'test-results/public-reviews/mobile-review.png'});
  // Copied links retain GitHub Pages' repository prefix and can open an older review.
  const link=await page.locator(`#review-${id}`).getByRole('link',{name:'Link to this review',exact:true}).getAttribute('href');assert.ok(link.startsWith(home));
  await page.locator(`#review-${id}`).getByRole('button',{name:'Copy review link',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),link);
  await close();await page.getByRole('button',{name:'Copy Discord handle',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'_gemini');
  await page.setViewportSize({width:1280,height:900});await page.locator('#search').fill('Steel Armoury');
  await page.screenshot({path:'test-results/public-reviews/desktop-card.png'});assert.equal(await page.locator('.card').count(),1);
  await page.locator('#sort').selectOption('name-asc');assert.equal(await page.locator('.card').count(),1);
  const linked=await context.newPage();await linked.goto(link);await linked.locator(`#review-${id}`).waitFor();await linked.close();await page.bringToFront();
  const edited=await s.mutate('edit',id,{changes:editFields(s.rows.get(id),{quality:1})});assert.equal(edited.status,200,await edited.text());await refresh();await summary.getByText('★ 3.0 / 5 · 2 reviews',{exact:true}).waitFor();await close();
  await s.mutate('unpublish',id);await refresh();await summary.getByText('★ 3.0 / 5 · 1 review',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Show.*photo/}).count(),0);await close();
  await s.mutate('delete',id,{confirm:true});assert.equal(s.photos.size,1);
  // Outage must retain an in-progress submission and keep CSV filters usable.
  await page.locator('.review-action[data-review-vendor="1"]').click();await page.getByLabel('Public display name').fill('Unsaved fighter');
  outage=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#review-service-status').getByText(/Reviews temporarily unavailable/).waitFor();assert.equal(await page.getByLabel('Public display name').inputValue(),'Unsaved fighter');
  await page.getByRole('button',{name:'Close review form',exact:true}).click();await page.locator('#search').fill('Sergey');assert.equal(await page.locator('.card').count(),1);
  await page.locator('.read-reviews').focus();await page.locator('.read-reviews').press('Enter');await page.locator('.public-review-dialog').waitFor({state:'visible'});await page.locator('#public-review-status').getByText(/Reviews temporarily unavailable/).waitFor();await close();
  outage=false;await page.locator('#review-service-status').getByRole('button',{name:'Retry reviews',exact:true}).click();await page.locator('#review-service-status').waitFor({state:'hidden'});
  await s.mutate('delete',second,{confirm:true});assert.equal(s.rows.size,0);assert.equal(s.photos.size,0);
  assert.deepEqual(errors,[]);
  await writeFile('test-results/public-reviews/browser.json',JSON.stringify({passed:true,browser:browser.version(),basePath,checks:['HEIC submission to publish/edit/unpublish/delete','score math','public/private photos','escaped text','copyable links and Discord','deep link','phone and desktop','keyboard','directory filters/sort','outage and unsaved submission preservation']},null,2));
  console.log('PASS: Phase 4 public browser lifecycle, privacy, score math, outage handling, and GitHub Pages subpath.');
} catch(error) {await page.screenshot({path:'test-results/public-reviews/failure.png',fullPage:true});console.log(await page.evaluate(()=>({clicks:window.reviewClickTrace,url:location.href,visibleDialogs:[...document.querySelectorAll('dialog')].map(d=>d.open)})));console.log((await page.locator('body').innerText()).slice(-4500));throw error;}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
