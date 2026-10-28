import { processPhoto, PHOTO_LIMITS } from '../photos/process-photo.js';
import { SubmissionClient } from './submission-client.js';
import { validateReview } from '../../supabase/functions/_shared/review-policy.js';
import { loadReviewConfig } from './config.js';

let config;
try { config = await loadReviewConfig(); } catch { /* Directory works without review configuration. */ }
if (config?.submissionEnabled && config.supabaseUrl && config.supabasePublishableKey && config.turnstileSiteKey) initialize(config);

function initialize(config) {
  document.documentElement.dataset.reviewSubmission = 'enabled';
  const categories = [
    ['quality', 'Quality', 'Workmanship, fit, finish, and how the item or service met your expectations.'],
    ['value_for_money', 'Value for money', 'Was the price worthwhile for the quality and service you received? Rate value, rather than how cheap it was.'],
    ['responsiveness', 'Responsiveness', 'How promptly did the craftsman reply to your messages?'],
    ['production_speed', 'Production speed', 'How promptly was the work produced, considering the agreed lead time? Exclude shipping and customs delays.'],
  ];
  const contacts = {
    facebook: ['Link to your Facebook profile', 'https://www.facebook.com/your.profile', 'url'],
    instagram: ['Link to your Instagram profile', 'https://www.instagram.com/your.profile', 'url'],
    whatsapp: ['Your WhatsApp number, including country code', '+1 555 123 4567', 'tel'],
    phone: ['Your phone number, including country code', '+1 555 123 4567', 'tel'],
    email: ['Your email address', 'you@example.com', 'email'],
  };
  const ratingLabels = ['Very poor', 'Poor', 'Satisfactory', 'Good', 'Excellent'];
  const dialog = document.createElement('dialog'); dialog.className = 'review-dialog';
  dialog.innerHTML = `<form id="review-form">
    <div class="review-heading"><h2 id="review-title">Write a review</h2><button type="button" class="review-close" aria-label="Close review form">×</button></div>
    <p>Your review will stay private until the moderator approves it.</p>
    <section aria-labelledby="review-public-heading"><h3 id="review-public-heading">Your experience</h3>
      <p>Review an item you received or a completed service so you can assess all four categories.</p>
      <label>Public display name<input name="display_name" required maxlength="80" autocomplete="nickname"></label>
      <label>Product or service<input name="product_service" required maxlength="200" placeholder="For example, steel gauntlets"></label>
      <label>Your experience<textarea name="experience" required maxlength="5000" rows="5" placeholder="What went well? What could have been better?"></textarea></label>
      <p>Rate every category. 1 = very poor, 3 = satisfactory, 5 = excellent.</p>
      ${categories.map(([field, label, help]) => `<fieldset><legend>${label}</legend><p class="review-help">${help}</p><div class="rating-options">${ratingLabels.map((text, i) => `<label class="star-option"><input type="radio" name="${field}" value="${i + 1}" required><span aria-hidden="true">${i + 1} ★</span><span class="review-sr-only">${i + 1} out of 5: ${text}</span></label>`).join('')}</div></fieldset>`).join('')}
    </section>
    <section aria-labelledby="review-private-heading" class="review-private"><h3 id="review-private-heading">Private contact details</h3>
      <p>Choose one way the moderator can reach you: Facebook, Instagram, WhatsApp, regular phone number, or email. These details stay private and will not appear on your review. If we cannot reach you, your review will not be approved.</p>
      <label>Contact name<input name="contact_name" required maxlength="120" autocomplete="name"></label>
      <label for="review-contact-method">Contact method</label><select id="review-contact-method" name="contact_method" required><option value="">Choose a contact method</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option><option value="phone">Regular phone number</option><option value="email">Email</option></select>
      <label><span id="review-contact-label">Contact details</span><input name="contact_details" required maxlength="500" autocomplete="off" aria-describedby="review-private-heading"></label>
    </section>
    <section aria-labelledby="review-photo-heading"><h3 id="review-photo-heading">Photos</h3>
      <p>Choose 1–5 photos of the item or work. JPEG, HEIC/HEIF, PNG, or WebP; up to 10 MB each. Remove addresses, payment details, and other people's private information.</p>
      <label>Choose photos<input id="review-photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"></label>
      <p id="review-photo-status" role="status"></p><div id="review-photo-list"></div>
      <label class="review-check"><input type="checkbox" name="photos_public" checked>Show my photos with my published review</label>
      <p id="review-photo-visibility">Your photos will be visible after the review is approved.</p>
    </section>
    <label class="review-check"><input type="checkbox" name="confirmed" required>I confirm this is my own experience and I have permission to share these photos.</label>
    <div class="review-honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div id="review-bot-check"></div><p id="review-bot-error" role="status"></p>
    <div class="review-actions"><button type="button" id="review-preview">Preview public review</button><button type="submit" id="review-submit">Submit for approval</button></div>
    <section id="review-preview-panel" hidden aria-label="Public review preview"></section>
    <p id="review-status" role="status"></p><div id="review-result" hidden></div>
    <p class="review-help">For corrections or removal requests, contact <code>_gemini</code> on Discord.</p>
  </form>`;
  dialog.setAttribute('aria-labelledby', 'review-title'); document.body.append(dialog);
  const form = dialog.querySelector('form'); const status = form.querySelector('#review-status');
  const input = form.querySelector('#review-photos'); const list = form.querySelector('#review-photo-list');
  const submit = form.querySelector('#review-submit'); const result = form.querySelector('#review-result');
  const client = new SubmissionClient(config);
  form.addEventListener('input', () => { form.querySelector('#review-preview-panel').hidden = true; });
  let vendor; let photos = []; let processing = false; let sending = false; let challenge = ''; let widget;
  const text = (tag, content) => { const element = document.createElement(tag); element.textContent = content; return element; };
  function setSending(value) {
    sending = value;
    for (const field of form.querySelectorAll('input,select,textarea,button')) field.disabled = value;
    input.disabled = value || processing;
  }
  function data() {
    const fields = new FormData(form);
    const review = { vendor_id: vendor.id };
    for (const name of ['display_name', 'contact_name', 'contact_method', 'contact_details', 'product_service', 'experience', 'website']) review[name] = String(fields.get(name) ?? '');
    for (const [name] of categories) review[name] = fields.has(name) ? Number(fields.get(name)) : null;
    review.photos_public = form.elements.photos_public.checked;
    review.confirmed = form.elements.confirmed.checked;
    return review;
  }
  function photoList() {
    list.replaceChildren();
    photos.forEach((photo, index) => {
      const item = document.createElement('div'); item.className = 'review-photo';
      item.append(text('p', photo.name));
      if (photo.url) { const img = document.createElement('img'); img.src = photo.url; img.alt = `Preview of ${photo.name}`; item.append(img); }
      if (photo.error) { const error = text('p', photo.error); error.className = 'review-error'; item.append(error); }
      const remove = text('button', 'Remove photo'); remove.type = 'button'; remove.disabled = sending || processing;
      remove.addEventListener('click', () => { if (photo.url) URL.revokeObjectURL(photo.url); photos.splice(index, 1); photoList(); });
      item.append(remove); list.append(item);
    });
  }
  input.addEventListener('change', async () => {
    const added = [...input.files]; input.value = '';
    if (photos.length + added.length > PHOTO_LIMITS.maxFiles) { status.textContent = 'Choose no more than 5 photos in total.'; return; }
    processing = true; input.disabled = true; submit.disabled = true;
    for (const file of added) {
      form.querySelector('#review-photo-status').textContent = `Preparing ${file.name} on your device…`;
      const photo = { name: file.name }; photos.push(photo);
      try {
        const converted = await processPhoto(file); photo.blob = converted.blob;
        photo.url = URL.createObjectURL(converted.blob);
        photo.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await converted.blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('');
      } catch (error) { photo.error = error.message; }
      photoList();
    }
    processing = false; input.disabled = false; submit.disabled = false; photoList();
    form.querySelector('#review-photo-status').textContent = 'Photos prepared locally. Nothing has been uploaded yet.';
  });
  form.elements.contact_method.addEventListener('change', () => {
    const choice = contacts[form.elements.contact_method.value] ?? ['Contact details', '', 'text'];
    form.querySelector('#review-contact-label').textContent = choice[0];
    form.elements.contact_details.placeholder = choice[1]; form.elements.contact_details.type = choice[2];
  });
  form.elements.photos_public.addEventListener('change', () => {
    form.querySelector('#review-photo-visibility').textContent = form.elements.photos_public.checked ? 'Your photos will be visible after the review is approved.' : 'Your photos will only be visible to the moderator.';
  });
  function validate() {
    if (!form.reportValidity()) return null;
    if (processing || !photos.length || photos.some((photo) => !photo.blob)) { status.textContent = 'Choose 1–5 valid photos. Remove or replace any photo with an error.'; return null; }
    const raw = data();
    try { validateReview(raw, new Set([vendor.id])); return raw; }
    catch (error) { status.textContent = error.message; return null; }
  }
  form.querySelector('#review-preview').addEventListener('click', () => {
    const review = validate(); if (!review) return;
    const panel = form.querySelector('#review-preview-panel'); panel.replaceChildren(text('h3', 'Public review preview'), text('p', `${review.display_name} · ${review.product_service}`));
    for (const [field, label] of categories) panel.append(text('p', `${label}: ${review[field]} / 5`));
    const experience = text('p', review.experience); experience.style.whiteSpace = 'pre-wrap'; panel.append(experience);
    panel.append(text('p', review.photos_public ? `${photos.length} photo(s) will be included after approval.` : 'Photos remain private.'));
    panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (sending) return;
    const review = validate(); if (!review) return;
    if (!challenge && !client.attempt) { status.textContent = 'Complete the bot check before submitting.'; return; }
    setSending(true); status.className = ''; result.hidden = true;
    try {
      const saved = await client.submit(review, photos, challenge, (message) => { status.textContent = message; });
      status.textContent = 'Your review was submitted for approval. It is not public yet.';
      result.replaceChildren(text('p', `Submission reference: ${saved.reference}`), text('p', 'Need a correction or removal? Contact _gemini on Discord and include this reference.')); result.hidden = false;
      form.querySelector('#review-preview-panel').hidden = true;
      setSending(false); submit.disabled = true;
      // Preserve the successful form for reference, but prevent a second submit.
      sending = true; form.querySelector('.review-close').disabled = false;
    } catch (error) {
      setSending(false); status.className = 'review-error'; status.textContent = error.message;
      challenge = ''; if (widget !== undefined) window.turnstile?.reset(widget);
    }
  });
  async function close() {
    if (sending && !result.hidden) { sending = false; dialog.close(); return; }
    if (sending) return;
    try {
      const cancelled = await client.cancel();
      if (cancelled?.reference) { status.textContent = `Your review was saved. Reference: ${cancelled.reference}`; }
    } catch { /* Keep form/permit for retry; an offline close cannot guarantee cleanup. */ }
    dialog.close();
  }
  form.querySelector('.review-close').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('.review-action'); if (!button) return;
    if (!vendor || vendor.id !== button.dataset.reviewVendor || !result.hidden) {
      if (processing || sending) return;
      try { await client.cancel(); } catch { status.textContent = 'Could not reset the previous attempt. Keep this page open and retry.'; dialog.showModal(); return; }
      photos.forEach((photo) => photo.url && URL.revokeObjectURL(photo.url)); photos = []; photoList(); form.reset();
      form.elements.contact_method.dispatchEvent(new Event('change'));
      form.elements.photos_public.dispatchEvent(new Event('change'));
      form.querySelector('#review-photo-status').textContent = '';
      status.textContent = ''; result.hidden = true; submit.disabled = false; challenge = '';
      if (widget !== undefined) window.turnstile?.reset(widget);
    }
    vendor = { id: button.dataset.reviewVendor, name: button.dataset.reviewName };
    form.querySelector('#review-title').textContent = `Review ${vendor.name}`;
    dialog.showModal();
    try {
      if (!window.turnstile) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.onload = resolve; script.onerror = () => reject(new Error('Bot check could not load. Check your connection and reopen the form.')); document.head.append(script);
      });
      if (widget === undefined) widget = window.turnstile.render(form.querySelector('#review-bot-check'), { sitekey: config.turnstileSiteKey, action: 'review-submit',
        callback: (token) => { challenge = token; form.querySelector('#review-bot-error').textContent = ''; },
        'expired-callback': () => { challenge = ''; }, 'error-callback': () => { challenge = ''; form.querySelector('#review-bot-error').textContent = 'Bot check could not finish. Please retry.'; } });
    } catch (error) { form.querySelector('#review-bot-error').textContent = error.message; }
  });
}
