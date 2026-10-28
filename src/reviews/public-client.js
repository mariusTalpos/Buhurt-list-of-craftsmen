export class PublicReviewClient {
  constructor(config, fetcher = globalThis.fetch.bind(globalThis)) { this.config = config; this.fetcher = fetcher; }
  async request(action, params = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(`${this.config.supabaseUrl}/functions/v1/review-public?${new URLSearchParams({ action, ...params })}`, {
        cache: 'no-store', signal: controller.signal, headers: { apikey: this.config.supabasePublishableKey,
          ...(this.config.previewToken ? { 'x-review-preview': this.config.previewToken } : {}) } });
      if (!response.ok) throw new Error(response.status === 404 && ['get', 'photo'].includes(action) ? `${action === 'photo' ? 'Photo' : 'Review'} unavailable. It may have been withdrawn.` : 'Reviews temporarily unavailable. Please try again.');
      return action === 'photo' ? await response.blob() : await response.json();
    } catch (error) {
      if (error.message?.includes('unavailable.')) throw error;
      throw new Error('Reviews temporarily unavailable. Please try again.');
    } finally { clearTimeout(timer); }
  }
}
