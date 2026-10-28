import { processPhoto, PHOTO_LIMITS } from '../assets/photos/process-photo.js';
const input = document.querySelector('#photos');
const button = document.querySelector('#process');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const urls = [];
button.addEventListener('click', async () => {
  const files = [...input.files];
  if (!files.length || files.length > PHOTO_LIMITS.maxFiles) {
    status.textContent = 'Choose between 1 and 5 photos.'; return;
  }
  urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  results.replaceChildren(); button.disabled = true;
  for (const [i, file] of files.entries()) {
    status.textContent = `Processing ${i + 1} of ${files.length}…`;
    const article = document.createElement('article');
    const label = document.createElement('p');
    label.textContent = file.name;
    article.append(label); results.append(article);
    try {
      const result = await processPhoto(file);
      const image = document.createElement('img');
      const url = URL.createObjectURL(result.blob); urls.push(url);
      image.src = url; image.alt = `Processed preview of ${file.name}`;
      const details = document.createElement('p');
      details.textContent = `${result.sourceWidth}×${result.sourceHeight} → ${result.width}×${result.height}; ${Math.round(result.blob.size / 1024)} KB; ${result.durationMs} ms.`;
      const download = document.createElement('a');
      download.href = url; download.download = 'processed-photo.jpg'; download.textContent = 'Save processed test image';
      article.append(details, image, download);
    } catch (error) {
      const message = document.createElement('p'); message.className = 'error';
      message.textContent = error.message; article.append(message);
    }
  }
  status.textContent = 'Finished. No photos were uploaded.'; button.disabled = false;
});
