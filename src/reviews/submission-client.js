export class SubmissionClient {
  constructor(config, fetcher = globalThis.fetch.bind(globalThis)) { this.config = config; this.fetcher = fetcher; this.attempt = null; }
  async request(action, { body, permit, index } = {}) {
    const headers = { apikey: this.config.supabasePublishableKey };
    if (this.config.previewToken) headers['x-review-preview'] = this.config.previewToken;
    if (permit) headers['x-upload-permit'] = permit;
    if (index !== undefined) headers['x-photo-index'] = String(index);
    if (!(body instanceof Blob)) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await this.fetcher(`${this.config.supabaseUrl}/functions/v1/review-submit?action=${action}`, {
      method: 'POST', headers, body: body instanceof Blob ? body : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(90_000),
    }); } catch { throw new Error('Connection interrupted. Your submission is not confirmed. Keep this page open and retry.'); }
    let result; try { result = await response.json(); } catch { throw new Error('Could not confirm the server response. Keep this page open and retry.'); }
    if (!response.ok) throw new Error(result.error ?? 'Could not submit your review. Please retry.');
    return result;
  }
  async cancel() {
    if (!this.attempt) return null;
    const result = await this.request('cancel', { permit: this.attempt.permit });
    this.attempt = null;
    return result;
  }
  async submit(review, photos, challenge, progress = () => {}) {
    const fingerprint = JSON.stringify(review) + photos.map((p) => p.sha256).join(',');
    if (this.attempt && this.attempt.fingerprint !== fingerprint) {
      const cancelled = await this.cancel();
      if (cancelled?.reference) return { reference: cancelled.reference, status: 'pending' };
    }
    if (this.attempt?.expires < Date.now()) {
      const cancelled = await this.cancel();
      if (cancelled?.reference) return { reference: cancelled.reference, status: 'pending' };
    }
    if (!this.attempt) {
      progress('Checking your review…');
      const result = await this.request('start', { body: { review, photos: photos.map((p) => ({ size: p.blob.size, sha256: p.sha256 })), challenge } });
      if (!result.permit || !result.expires) throw new Error('The server did not confirm upload permission. Please retry.');
      this.attempt = { ...result, fingerprint, uploaded: new Set(), finishing: false };
    }
    try {
      for (const [index, photo] of photos.entries()) {
        if (this.attempt.uploaded.has(index)) continue;
        progress(`Uploading photo ${index + 1} of ${photos.length}…`);
        await this.request('photo', { permit: this.attempt.permit, index, body: photo.blob });
        this.attempt.uploaded.add(index);
      }
      progress('Saving your review…'); this.attempt.finishing = true;
      const saved = await this.request('finish', { permit: this.attempt.permit });
      if (!saved.reference || saved.status !== 'pending') throw new Error('The server did not confirm your review was saved. Please retry.');
      this.attempt = null; return saved;
    } catch (error) {
      // Before finalization there is no review to recover, so remove partial files.
      // After finalization a lost reply may hide a committed row: preserve the permit
      // and retry finish idempotently instead of submitting another review.
      if (this.attempt && !this.attempt.finishing) { try { await this.cancel(); } catch { /* Retry cleanup using the same permit next time. */ } }
      throw error;
    }
  }
}
