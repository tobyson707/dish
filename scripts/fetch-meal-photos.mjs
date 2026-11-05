// Downloads freely-licensed meal photos from Wikimedia Commons into public/meals
// and records attribution in src/data/meal-photos.json.
//
//   node scripts/fetch-meal-photos.mjs            # fetch missing photos
//   node scripts/fetch-meal-photos.mjs --force    # re-fetch everything
//
// Only CC0 / Public domain / CC BY / CC BY-SA images are accepted. Review the
// results visually before shipping — automatic search can pick the wrong dish.
// Requires network access to commons.wikimedia.org and upload.wikimedia.org.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MEALS } from './catalogue-data.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = `${ROOT}public/meals`
const MANIFEST = `${ROOT}src/data/meal-photos.json`
const UA = 'DISH-meal-photos/1.0 (https://github.com/tobyson707/dish)'
const OK_LICENSE = /^(cc0|public domain|pd|cc[- ]by(-sa)?[- ]?\d)/i
const force = process.argv.includes('--force')

// Better search terms for some dishes
const QUERY = {
  'jollof-rice-chicken': 'jollof rice chicken', 'white-rice-stew': 'rice and stew nigerian', 'ofada-rice-ayamase': 'ofada rice',
  'beans-plantain': 'beans and plantain', 'akara-pap': 'akara', 'egusi-pounded-yam': 'egusi soup pounded yam', 'okra-soup-eba': 'okra soup eba',
  'vegetable-soup-semo': 'edikang ikong', 'efo-riro-amala': 'efo riro', 'ogbono-soup-eba': 'ogbono soup', 'pepper-soup-goat': 'goat meat pepper soup',
  'roasted-plantain-groundnut': 'boli plantain', 'yam-porridge': 'yam porridge', 'abacha': 'abacha african salad', 'agege-bread-egg': 'agege bread',
  'custard-banana': 'custard', 'gizdodo': 'gizdodo', 'moi-moi-pap': 'moi moi', 'beef-sausage-roll': 'sausage roll', 'moimoi-rice': 'rice and beans nigerian',
}

async function api(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php')
  for (const [k, v] of Object.entries({ format: 'json', origin: '*', ...params })) u.searchParams.set(k, String(v))
  const r = await fetch(u, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`Commons API ${r.status}`)
  return r.json()
}

async function findPhoto(query) {
  const res = await api({ action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 8, prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: 1000 })
  const pages = Object.values(res.query?.pages ?? {}).sort((a, b) => a.index - b.index)
  for (const p of pages) {
    const ii = p.imageinfo?.[0]
    const meta = ii?.extmetadata ?? {}
    const license = meta.LicenseShortName?.value ?? ''
    if (!ii?.thumburl || !/jpeg|png|webp/.test(ii.mime) || !OK_LICENSE.test(license)) continue
    const artist = (meta.Artist?.value ?? 'Unknown').replace(/<[^>]+>/g, '').trim()
    return { url: ii.thumburl, credit: `${artist} · ${license} · Wikimedia Commons (${ii.descriptionurl ?? p.title})` }
  }
  return null
}

mkdirSync(OUT_DIR, { recursive: true })
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
let added = 0
for (const m of MEALS) {
  if (manifest[m.slug] && !force) continue
  try {
    const hit = (await findPhoto(QUERY[m.slug] ?? m.name)) ?? (await findPhoto(m.name.split(' with ')[0]))
    if (!hit) {
      console.log(`– no licensed photo for ${m.slug}`)
      continue
    }
    const img = await fetch(hit.url, { headers: { 'user-agent': UA } })
    if (!img.ok) throw new Error(`download ${img.status}`)
    const ext = (img.headers.get('content-type') ?? '').includes('png') ? 'png' : 'jpg'
    writeFileSync(`${OUT_DIR}/${m.slug}.${ext}`, Buffer.from(await img.arrayBuffer()))
    manifest[m.slug] = { src: `/meals/${m.slug}.${ext}`, alt: m.name, credit: hit.credit }
    added++
    console.log(`✓ ${m.slug}`)
  } catch (e) {
    console.log(`! ${m.slug}: ${e.message}`)
  }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Done: ${added} added, ${Object.keys(manifest).length} total. Review images in public/meals before committing.`)
