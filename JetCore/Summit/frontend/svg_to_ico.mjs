import { Resvg } from '@resvg/resvg-js'
import fs from 'fs'

// Exact logo from the sidebar: orange circle + white lightning bolt
const svgData = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256">
  <circle cx="12" cy="12" r="12" fill="#ea580c"/>
  <polygon points="13,3 7.5,13 12,13 10.5,21 17,10.5 12.5,10.5 14.5,3" fill="white"/>
</svg>`

const outIco = '../JetCore/jetcore.ico'
const sizes  = [16, 32, 48, 64, 128, 256]

const pngs = sizes.map(size => {
  const resvg = new Resvg(svgData, { fitTo: { mode: 'width', value: size }, background: 'transparent' })
  return resvg.render().asPng()
})

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)

const entries = []
let offset = 6 + 16 * pngs.length
for (let i = 0; i < pngs.length; i++) {
  const e = Buffer.alloc(16)
  const s = sizes[i]
  e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1)
  e.writeUInt8(0, 2); e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
  entries.push(e)
  offset += pngs[i].length
}

fs.writeFileSync(outIco, Buffer.concat([header, ...entries, ...pngs]))
console.log(`Saved ${outIco} — ${sizes.join('/')}px — ${offset} bytes`)
