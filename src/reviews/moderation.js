import { createClient } from '@supabase/supabase-js';
import { loadReviewConfig } from './config.js';
const $ = selector => document.querySelector(selector);
const fields = [['display_name', 'Public display name', 80], ['product_service', 'Product or service', 200],
  ['experience', 'Experience', 5000], ['contact_name', 'Contact name', 120], ['contact_details', 'Contact details', 500]];
const ratings = [['quality', 'Quality'], ['value_for_money', 'Value for money'], ['responsiveness', 'Responsiveness'], ['production_speed', 'Production speed']];
let client, config, selected, status = 'pending', dirty = false, busy = false, objectUrls = [], selection = 0;
const vendors = new Map();
function message(text, error = false) { $('#message').textContent = text; $('#message').dataset.error = String(error); }
function clearPhotos() { selection++; objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = []; }
function reset() { clearPhotos(); selected = null; dirty = false; $('#detail').replaceChildren(); $('#queue').replaceChildren(); $('#workspace').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; }
async function api(action, body, params = {}) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) { reset(); throw new Error('Your session ended. Sign in again.'); }
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`${config.supabaseUrl}/functions/v1/review-moderate?${query}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', headers: { apikey: config.supabasePublishableKey,
      Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) { await client.auth.signOut({ scope: 'local' }); reset(); }
    throw new Error(result.error ?? 'The request failed. Reload before retrying.');
  }
  return action === 'photo' ? response.blob() : response.json();
}
function button(text, click) { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', click); return node; }
async function run(work) {
  if (busy) return; busy = true;
  const controls = [...document.querySelectorAll('button,input,select,textarea')];
  const disabled = controls.map(node => node.disabled); controls.forEach(node => { node.disabled = true; });
  try { await work(); } catch (error) { message(error.message, true); }
  finally { controls.forEach((node, i) => { if (node.isConnected) node.disabled = disabled[i]; }); busy = false; }
}
function canLeave() { return !dirty || confirm('Discard unsaved changes?'); }
async function queue() {
  const result = await api('list', null, { status });
  $('#workspace').hidden = false; $('#login').hidden = true; $('#logout').hidden = false;
  $('#queue-heading').textContent = `${status === 'pending' ? 'Pending' : 'Published'} reviews (${result.reviews.length})`;
  for (const name of ['pending', 'published']) $(`#${name}`).setAttribute('aria-pressed', String(status === name));
  $('#queue').replaceChildren();
  for (const row of result.reviews) {
    const li = document.createElement('li');
    const open = button(row.display_name, () => { if (canLeave()) run(() => load(row.id)); });
    open.setAttribute('aria-current', String(selected?.id === row.id));
    const small = document.createElement('small'); small.textContent = `${vendors.get(row.vendor_id) ?? `Craftsman ${row.vendor_id}`} · ${row.product_service}`;
    open.append(small); li.append(open); $('#queue').append(li);
  }
  if (!result.reviews.length) { const li = document.createElement('li'); li.textContent = `No ${status} reviews.`; $('#queue').append(li); }
}
async function load(id) {
  const { review } = await api('get', null, { id }); render(review); await queue();
  message('Review loaded. Contact details and owner notes stay private.');
  $('#detail h2').focus();
}
function render(row) {
  clearPhotos(); selected = row; dirty = false; const currentSelection = selection;
  const detail = $('#detail');
  // Template is static. All submitted values are assigned as text/value below.
  detail.innerHTML = `<h2 tabindex="-1"></h2><span class="state"></span><p class="hint" id="review-ref"></p>
    <form id="edit-review"><fieldset><legend>Public review</legend>
      ${fields.slice(0, 3).map(([key, label, max]) => `<label>${label}${key === 'experience' ? `<textarea name="${key}" rows="5" maxlength="${max}" required></textarea>` : `<input name="${key}" maxlength="${max}" required>`}</label>`).join('')}
      <p class="hint">All four ratings are required. Value for money considers quality; production speed excludes shipping.</p>
      <div class="ratings">${ratings.map(([key, label]) => `<div><label for="moderate-${key}">${label}</label><select id="moderate-${key}" name="${key}" required><option value="">Choose…</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n} ★</option>`).join('')}</select></div>`).join('')}</div></fieldset>
      <fieldset><legend>Private contact and notes</legend>
      <label>Contact name<input name="contact_name" maxlength="120" required></label>
      <label for="moderate-contact-method">Contact method</label><select id="moderate-contact-method" name="contact_method" required>${[['facebook','Facebook'],['instagram','Instagram'],['whatsapp','WhatsApp'],['phone','Regular phone number'],['email','Email']].map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <label>Contact details<input name="contact_details" maxlength="500" required></label>
      <label>Owner note<textarea name="owner_note" maxlength="5000" rows="3"></textarea></label></fieldset>
      <fieldset><legend>Photos</legend><p id="photo-permission"></p><div class="photos"></div></fieldset>
      <p class="hint">Make corrections agreed with the reviewer. Save changes before approving.</p>
      <div class="actions"><button type="submit">Save changes</button><button type="button" id="approve">Approve</button><button type="button" id="unpublish">Unpublish</button><button type="button" id="delete" class="danger">Delete permanently</button></div>
    </form>`;
  detail.querySelector('h2').textContent = vendors.get(row.vendor_id) ?? `Craftsman ${row.vendor_id}`;
  detail.querySelector('.state').textContent = row.status === 'pending' ? 'Pending' : 'Published';
  $('#review-ref').textContent = `Submitted ${new Date(row.created_at).toLocaleString()} · Reference ${row.id}`;
  const form = $('#edit-review');
  for (const key of [...fields.map(([key]) => key), ...ratings.map(([key]) => key), 'contact_method', 'owner_note']) form.elements.namedItem(key).value = row[key];
  $('#photo-permission').textContent = row.photos_public ? 'The reviewer allows public photos. Uncheck any photo you want to omit; the original stays private for your reference.' : 'The reviewer chose private photos. None will be shown publicly.';
  for (const [index, path] of row.photo_paths.entries()) {
    const figure = document.createElement('figure'); figure.className = 'photo';
    const caption = document.createElement('p'); caption.textContent = `Photo ${index + 1}: loading…`; figure.append(caption);
    if (row.photos_public) {
      const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'include-photo'; checkbox.value = path; checkbox.checked = !row.excluded_photo_paths.includes(path);
      label.append(checkbox, `Include photo ${index + 1} publicly`); figure.append(label);
    }
    form.querySelector('.photos').append(figure);
    api('photo', null, { id: row.id, index: String(index) }).then(blob => {
      if (selection !== currentSelection) return;
      const url = URL.createObjectURL(blob); objectUrls.push(url);
      const img = document.createElement('img'); img.alt = `Review photo ${index + 1}`; img.src = url;
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `Open photo ${index + 1} full size`;
      caption.replaceWith(img, link);
    }).catch(() => { if (selection === currentSelection) caption.textContent = `Photo ${index + 1} could not be loaded. Reload to retry.`; });
  }
  $('#approve').hidden = row.status === 'published'; $('#unpublish').hidden = row.status !== 'published';
  form.addEventListener('input', () => { dirty = true; $('#approve').disabled = true; });
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const changes = Object.fromEntries([...fields.map(([key]) => key), 'contact_method', 'owner_note'].map(key => [key, form.elements.namedItem(key).value]));
    ratings.forEach(([key]) => { changes[key] = Number(form.elements.namedItem(key).value); });
    changes.excluded_photo_paths = row.photos_public ? [...form.querySelectorAll('[name="include-photo"]')].filter(node => !node.checked).map(node => node.value) : row.excluded_photo_paths;
    const { review } = await api('edit', { id: row.id, expected_updated_at: row.updated_at, changes });
    render(review); await queue(); message('Changes saved to the same review.');
  }); });
  for (const action of ['approve', 'unpublish', 'delete']) $(`#${action}`).addEventListener('click', () => {
    if (action === 'delete' && !confirm('Permanently delete this review and all its photos? This cannot be undone.')) return;
    run(async () => {
      const result = await api(action, { id: row.id, expected_updated_at: row.updated_at, ...(action === 'delete' ? { confirm: true } : {}) });
      if (action === 'delete') { clearPhotos(); selected = null; dirty = false; detail.textContent = 'Review and stored photos deleted.'; }
      else { status = result.review.status; render(result.review); }
      await queue(); message(action === 'approve' ? 'Review approved.' : action === 'unpublish' ? 'Review returned to pending. Public photo access withdrawn.' : 'Review and stored photos deleted.');
    });
  });
}
async function initialize() {
  try {
    config = await loadReviewConfig();
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error();
    client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
    // No localStorage session or private review cache. Reload requires sign in.
    reset(); message('Sign in to view the private review queue.');
    try { const csv = await (await fetch(new URL('../../vendors.csv', import.meta.url), { cache: 'no-store' })).text();
      for (const line of csv.split(/\r?\n/).slice(1)) { const match = /^(\d+),([^,]+)/.exec(line); if (match) vendors.set(match[1], match[2]); }
    } catch { /* Vendor IDs remain usable if the CSV is unavailable. */ }
    $('#login-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
      const form = event.currentTarget; const email = form.elements.email.value.trim(); const password = form.elements.password.value; form.elements.password.value = '';
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Sign in failed. Check your moderator email and password.');
      await queue(); message('Signed in. Choose a review from the queue.');
    }); });
    $('#logout').addEventListener('click', () => run(async () => {
      if (!canLeave()) return;
      const { error } = await client.auth.signOut({ scope: 'local' }); reset();
      message(error ? 'Local data cleared. Server sign-out could not be confirmed; close this page.' : 'Signed out. Private review data cleared.', Boolean(error));
    }));
    for (const name of ['pending', 'published']) $(`#${name}`).addEventListener('click', () => { if (canLeave()) run(async () => { status = name; clearPhotos(); selected = null; dirty = false; $('#detail').textContent = 'Select a review to inspect it.'; await queue(); message(`${name === 'pending' ? 'Pending' : 'Published'} queue loaded.`); }); });
    $('#refresh').addEventListener('click', () => { if (canLeave()) run(async () => { if (selected) await load(selected.id); else await queue(); }); });
    client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') reset(); });
    addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    addEventListener('pagehide', clearPhotos);
  } catch { message('Moderator configuration is unavailable. Configure the Supabase URL and publishable key before opening this page.', true); }
}
initialize();
