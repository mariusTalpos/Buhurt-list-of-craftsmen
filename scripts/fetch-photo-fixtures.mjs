import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const fixtures = [
  ['libheif-example.heic', 'https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic', '7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2'],
  ['orientation-6.jpg', 'https://raw.githubusercontent.com/recurser/exif-orientation-examples/master/Landscape_6.jpg', '9b344e9f0c869d8637ea22e672df9451d8d3cc1d2d0b291af3b284e538e5f124'],
  ['phone.heic', 'https://drive.google.com/uc?export=view&id=1J_761fe_HWSijAthq7h_D2Zsf1_es1cT', 'c02a2d70040fa05840231c29f183ce51d045bea027839e3d2ca4a6e968371541'],
];
await mkdir('tests/fixtures', { recursive: true });
for (const [name, url, expected] of fixtures) {
  let data;
  try { data = await readFile(`tests/fixtures/${name}`); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: download returned ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`${name}: fixture hash changed; review the upstream source before updating it.`);
  await writeFile(`tests/fixtures/${name}`, data);
  console.log(`Verified ${name}`);
}
