// node scripts/_slice.mjs <png> [chunkH=1300] [scale=0.6] → writes <png>.N.png slices
import sharp from 'sharp'
const [f, ch = 1300, sc = 0.6] = process.argv.slice(2)
const m = await sharp(f).metadata()
const n = Math.ceil(m.height / ch)
for (let i = 0; i < n; i++) {
  const h = Math.min(+ch, m.height - i * ch)
  await sharp(f).extract({ left: 0, top: i * ch, width: m.width, height: h }).resize({ width: Math.round(m.width * sc) }).toFile(`${f.replace(/\.png$/, '')}.s${i}.png`)
}
console.log(n)
