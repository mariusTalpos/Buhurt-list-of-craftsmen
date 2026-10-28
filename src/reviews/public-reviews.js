import { PublicReviewClient } from './public-client.js';
import { loadReviewConfig } from './config.js';
const categories = [['quality', 'Quality'], ['value_for_money', 'Value for money'], ['responsiveness', 'Responsiveness'], ['production_speed', 'Production speed']];
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const button = (text, action) => { const el = node('button', text); el.type = 'button'; el.addEventListener('click', action); return el; };
const score = value => `${value.toFixed(1)} / 5`;
const contact = () => node('p', 'Contact _gemini on Discord to correct or remove a review, or report a concern. Include the review link or submission reference.', 'public-review-contact');
document.querySelector('#copy-discord')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('_gemini'); document.querySelector('#discord-copy-status').textContent = 'Discord handle copied.'; }
  catch { document.querySelector('#discord-copy-status').textContent = 'Select and copy _gemini.'; }
});
let config;
try { config = await loadReviewConfig(); } catch { /* CSV directory stays independent. */ }
if (config?.reviewsEnabled && config.supabaseUrl && config.supabasePublishableKey) initialize(config);

function initialize(config) {
  const client = new PublicReviewClient(config);
  const vendors = new Map(); let summaries = new Map(), state = 'loading', loadingSummary = false, summaryAgain = false;
  let generation = 0, urls = [], offset = 0, currentVendor, opener;
  document.documentElement.dataset.reviewPublic = 'enabled';
  const dialog = document.createElement('dialog'); dialog.className = 'public-review-dialog'; dialog.setAttribute('aria-labelledby', 'public-review-title');
  dialog.innerHTML = `<div class="public-review-heading"><h2 id="public-review-title"></h2><button type="button" aria-label="Close reviews">×</button></div><div id="public-review-summary"></div><div class="public-review-tools"><button type="button" id="refresh-public-reviews">Refresh reviews</button></div><div id="public-review-list"></div><p id="public-review-status" role="status" aria-live="polite"></p><div id="public-review-next"></div>`;
  dialog.append(contact()); document.body.append(dialog);
  const list = dialog.querySelector('#public-review-list'), notice = dialog.querySelector('#public-review-status'), next = dialog.querySelector('#public-review-next');
  const banner = document.querySelector('#review-service-status');
  function clearImages() { generation++; urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
  function summaryContents(summary) {
    const fragment = document.createDocumentFragment();
    if (!summary?.count) { fragment.append(node('p', 'No reviews yet', 'review-no-scores')); return fragment; }
    fragment.append(node('p', `★ ${score(summary.overall)} · ${summary.count} ${summary.count === 1 ? 'review' : 'reviews'}`, 'review-overall'));
    const dl = node('dl', undefined, 'review-category-scores');
    categories.forEach(([field, label]) => { const pair = node('div'); pair.append(node('dt', label), node('dd', score(summary[field]))); dl.append(pair); });
    fragment.append(dl); return fragment;
  }
  function cards() {
    for (const slot of document.querySelectorAll('[data-review-summary]')) {
      slot.replaceChildren(state === 'ready' ? summaryContents(summaries.get(slot.dataset.reviewSummary)) : node('p', state === 'loading' ? 'Loading reviews…' : 'Reviews temporarily unavailable.'));
    }
    if (currentVendor && dialog.open) {
      const slot = dialog.querySelector('#public-review-summary');
      slot.replaceChildren(state === 'ready' ? summaryContents(summaries.get(currentVendor)) : node('p', state === 'loading' ? 'Loading scores…' : 'Scores temporarily unavailable.'));
    }
  }
  async function refreshSummaries() {
    if (loadingSummary) { summaryAgain = true; return; } loadingSummary = true;
    try {
      const data = await client.request('summaries'); summaries = new Map(data.summaries.map(summary => [summary.vendor_id, summary])); state = 'ready'; banner.replaceChildren();
    } catch {
      state = 'error'; summaries.clear(); banner.replaceChildren(node('span', 'Reviews temporarily unavailable. Vendor browsing still works. '), button('Retry reviews', refreshSummaries));
    } finally { loadingSummary = false; cards(); if (summaryAgain) { summaryAgain = false; refreshSummaries(); } }
  }
  function close(updateUrl = true) {
    clearImages(); list.replaceChildren(); next.replaceChildren(); currentVendor = null;
    if (dialog.open) dialog.close();
    if (updateUrl) { const url = new URL(location.href); url.searchParams.delete('reviews'); url.searchParams.delete('review'); history.replaceState(null, '', url); }
    if (opener?.isConnected) opener.focus();
  }
  function reviewLink(row) { const url = new URL(location.href); url.searchParams.set('reviews', row.vendor_id); url.searchParams.set('review', row.id); return url; }
  function article(row, version) {
    const item = node('article', undefined, 'published-review'); item.id = `review-${row.id}`;
    item.append(node('h3', row.display_name), node('p', row.product_service, 'public-review-product'));
    const date = node('time', new Date(row.published_at).toLocaleDateString()); date.dateTime = row.published_at; item.append(date);
    const overall = categories.reduce((sum, [field]) => sum + row[field], 0) / 4;
    item.append(node('p', `Overall ${score(overall)}`, 'review-overall'));
    const ratings = node('ul', undefined, 'public-review-ratings'); categories.forEach(([field, label]) => ratings.append(node('li', `${label}: ${row[field]} / 5`))); item.append(ratings);
    item.append(node('p', row.experience, 'public-review-experience'));
    if (row.photos.length) {
      const photos = node('div', undefined, 'public-review-photos'); let opened = false;
      const show = button(`Show ${row.photos.length} ${row.photos.length === 1 ? 'photo' : 'photos'}`, async () => {
        if (opened) return; opened = true; show.disabled = true; show.textContent = 'Photos';
        for (const index of row.photos) {
          const figure = node('figure'); photos.append(figure);
          async function loadPhoto() {
            figure.replaceChildren(node('p', `Loading photo ${index + 1}…`));
            try {
              const blob = await client.request('photo', { id: row.id, index: String(index) });
              if (generation !== version || !dialog.open) return;
              const url = URL.createObjectURL(blob); urls.push(url);
              const img = node('img'); img.src = url; img.alt = `${row.product_service} — review photo ${index + 1}`;
              const link = node('a', `Open photo ${index + 1} full size`); link.href = url; link.target = '_blank'; link.rel = 'noopener'; figure.replaceChildren(img, link);
            } catch (error) { if (generation === version) figure.replaceChildren(node('p', error.message), button('Retry photo', loadPhoto)); }
          }
          await loadPhoto(); if (generation !== version) break;
        }
      }); item.append(show, photos);
    } else item.append(node('p', 'No public photos.', 'public-review-photo-note'));
    const link = node('a', 'Link to this review'); link.href = reviewLink(row).href;
    const copyStatus = node('span'); copyStatus.setAttribute('role', 'status');
    const copy = button('Copy review link', async () => {
      try { await navigator.clipboard.writeText(reviewLink(row).href); copyStatus.textContent = 'Link copied.'; }
      catch { copyStatus.textContent = 'Use “Link to this review” to copy the address.'; }
    });
    const tools = node('div', undefined, 'public-review-tools'); tools.append(link, copy, copyStatus); item.append(tools); return item;
  }
  async function load(vendor, linkedId, more = false) {
    if (!more) { clearImages(); offset = 0; list.replaceChildren(); }
    const version = generation; next.replaceChildren(); notice.textContent = 'Loading reviews…';
    try {
      const data = await client.request(linkedId ? 'get' : 'list', linkedId ? { id: linkedId } : { vendor_id: vendor, offset: String(offset) });
      if (generation !== version || currentVendor !== vendor || !dialog.open) return;
      const rows = linkedId ? [data.review] : data.reviews;
      if (rows.some(row => row.vendor_id !== vendor)) throw new Error('Review unavailable. Check the review link.');
      if (!rows.length && !more) list.append(node('p', 'No reviews yet. Have experience with this craftsman? Close this view and choose “Write a review” on their card.'));
      rows.forEach(row => list.append(article(row, version))); offset += rows.length; notice.textContent = '';
      if (linkedId) next.append(button('View all reviews', () => {
        const url = new URL(location.href); url.searchParams.delete('review'); history.replaceState(null, '', url); load(vendor);
      }));
      else if (data.has_more) next.append(button('Load more reviews', () => load(vendor, null, true)));
    } catch (error) {
      if (generation !== version || currentVendor !== vendor) return;
      notice.textContent = error.message; next.append(button('Retry', () => load(vendor, linkedId, more)));
    }
  }
  function route() {
    if (!vendors.size) return;
    const url = new URL(location.href), vendor = url.searchParams.get('reviews');
    if (!vendor) { close(false); return; }
    currentVendor = vendor; dialog.querySelector('#public-review-title').textContent = `Reviews for ${vendors.get(vendor) ?? 'this craftsman'}`;
    if (!dialog.open) dialog.showModal(); cards();
    if (!vendors.has(vendor)) { clearImages(); list.replaceChildren(); next.replaceChildren(); notice.textContent = 'Craftsman unavailable. Check the review link.'; return; }
    load(vendor, url.searchParams.get('review')); refreshSummaries();
  }
  dialog.querySelector('[aria-label="Close reviews"]').addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.querySelector('#refresh-public-reviews').addEventListener('click', route);
  document.addEventListener('click', event => {
    const link = event.target.closest('.read-reviews');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); opener = link; history.pushState(null, '', link.href); route();
  });
  let initialRoute = false;
  document.addEventListener('directory:rendered', event => {
    event.detail.vendors.forEach(vendor => vendors.set(vendor.id, vendor.name)); cards();
    if (!initialRoute && vendors.size) { initialRoute = true; route(); }
  });
  addEventListener('popstate', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshSummaries(); if (dialog.open) route(); } });
  addEventListener('pagehide', clearImages);
  document.dispatchEvent(new Event('directory:request')); refreshSummaries();
}
