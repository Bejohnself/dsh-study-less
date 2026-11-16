/**
 * Turn the reference art into the mascot the panel ships with.
 *
 * The sources are already circular avatars (RGBA, transparent corners), so this
 * script only has to find the circle, crop it square, and downsize it with
 * alpha-weighted averaging — a straight average would fringe the feathered edge
 * with whatever colour the transparent pixels happen to carry.
 *
 * Output goes into `src/client/mascot.ts` as data URLs, so the plugin still
 * ships no asset files. Run: node scripts/build-mascot.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { deflateSync, inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SIZE = 128
const PADDING = 1.02

const SOURCES = [
  { file: 'figure/可爱.png', key: 'cute' },
  { file: 'figure/开心.png', key: 'happy' },
  { file: 'figure/担心.png', key: 'worried' },
  { file: 'figure/收到.png', key: 'ack' },
  { file: 'figure/无聊.png', key: 'bored' },
  { file: 'figure/疑惑.png', key: 'puzzled' },
]

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into raw pixels. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data.readUInt8(8)
      colorType = data.readUInt8(9)
      const interlace = data.readUInt8(12)
      if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: depth ${bitDepth}, interlace ${interlace}`)
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : 3
  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * channels)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)]
    const current = Buffer.from(inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      if (filter === 1) current[x] = (current[x] + left) & 0xff
      else if (filter === 2) current[x] = (current[x] + up) & 0xff
      else if (filter === 3) current[x] = (current[x] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        current[x] = (current[x] + predictor) & 0xff
      }
    }
    current.copy(out, y * stride)
    previous = current
  }
  return { width, height, channels, pixels: out }
}

/** Flood fill from the border for sources that are still on a flat background. */
function backgroundMask(image, tolerance) {
  const { width, height, channels, pixels } = image
  const reference = [pixels[0], pixels[1], pixels[2]]
  const background = new Uint8Array(width * height)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (background[index] === 1) return
    const base = index * channels
    const distance =
      Math.abs(pixels[base] - reference[0]) + Math.abs(pixels[base + 1] - reference[1]) + Math.abs(pixels[base + 2] - reference[2])
    if (distance > tolerance) return
    background[index] = 1
    queue.push(index)
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }
  while (queue.length > 0) {
    const index = queue.pop()
    const x = index % width
    const y = (index - x) / width
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return background
}

/** Alpha of one source pixel: the artwork's own alpha, or 0 where filled out. */
function alphaAt(image, background, x, y) {
  const index = y * image.width + x
  if (background[index] === 1) return 0
  return image.channels === 4 ? image.pixels[index * 4 + 3] : 255
}

/** Bounding box of everything with alpha above a threshold. */
function boundsOf(image, background) {
  let left = image.width
  let right = -1
  let top = image.height
  let bottom = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (alphaAt(image, background, x, y) <= 8) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return { left, right, top, bottom }
}

/** Square crop that keeps the circle centred: side = the shorter bbox edge. */
function squareOf(box) {
  const width = box.right - box.left + 1
  const height = box.bottom - box.top + 1
  const side = Math.min(width, height)
  return {
    left: box.left + Math.round((width - side) / 2),
    top: box.top + Math.round((height - side) / 2),
    side,
  }
}

/**
 * Resize to a square with alpha-weighted averaging.
 *
 * Colours are summed premultiplied and divided by the summed alpha, so the
 * transparent side of a feathered edge contributes nothing instead of dragging
 * the colour toward black.
 */
function resize(image, background, square, size) {
  const out = Buffer.alloc(size * size * 4)
  const scale = square.side / size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const x0 = square.left + x * scale
      const x1 = square.left + (x + 1) * scale
      const y0 = square.top + y * scale
      const y1 = square.top + (y + 1) * scale
      let r = 0
      let g = 0
      let b = 0
      let alphaSum = 0
      let count = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          count += 1
          if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue
          const alpha = alphaAt(image, background, sx, sy)
          if (alpha === 0) continue
          const base = (sy * image.width + sx) * image.channels
          const weight = alpha / 255
          r += image.pixels[base] * weight
          g += image.pixels[base + 1] * weight
          b += image.pixels[base + 2] * weight
          alphaSum += weight
        }
      }
      const target = (y * size + x) * 4
      if (alphaSum === 0) continue
      out[target] = Math.round(r / alphaSum)
      out[target + 1] = Math.round(g / alphaSum)
      out[target + 2] = Math.round(b / alphaSum)
      out[target + 3] = Math.round((alphaSum / count) * 255)
    }
  }
  return out
}

/** Encode RGBA pixels as a PNG. */
function encodePng(pixels, size) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const chunks = []
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    const crcBuffer = Buffer.alloc(4)
    crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    chunks.push(length, body, crcBuffer)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  chunk('IHDR', ihdr)
  chunk('IDAT', deflateSync(raw, { level: 9 }))
  chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

await mkdir(new URL('../figure/out/', import.meta.url), { recursive: true })
const entries = []
let total = 0
for (const source of SOURCES) {
  const bytes = await readFile(new URL(`../${source.file}`, import.meta.url))
  const image = decodePng(bytes)
  // Already keyed artwork: trust its alpha. Flat-background art: fill it out.
  const hasAlpha = image.channels === 4 && image.pixels.some((value, index) => index % 4 === 3 && value < 250)
  const background = hasAlpha ? new Uint8Array(image.width * image.height) : backgroundMask(image, 70)
  const box = boundsOf(image, background)
  const square = squareOf(box)
  const padded = {
    left: square.left - Math.round((square.side * (PADDING - 1)) / 2),
    top: square.top - Math.round((square.side * (PADDING - 1)) / 2),
    side: Math.round(square.side * PADDING),
  }
  const pixels = resize(image, background, padded, SIZE)
  const png = encodePng(pixels, SIZE)
  await writeFile(new URL(`../figure/out/${source.key}.png`, import.meta.url), png)
  total += png.length
  console.log(`${source.key.padEnd(8)} ${image.width}x${image.height} → ${SIZE}px  ${(png.length / 1024).toFixed(1)} KiB`)
  entries.push({ key: source.key, base64: png.toString('base64') })
}

const module = `/**
 * The mascot art, inlined as data URLs.
 *
 * Generated by scripts/build-mascot.mjs from the circular avatars in figure/.
 * Regenerate with \`node scripts/build-mascot.mjs\`; do not hand-edit.
 */
export type MascotMood = 'cute' | 'happy' | 'worried' | 'ack' | 'bored' | 'puzzled'

export const MASCOT: Record<MascotMood, string> = {
${entries.map(entry => `  ${entry.key}: 'data:image/png;base64,${entry.base64}',`).join('\n')}
}
`
await writeFile(new URL('../src/client/mascot.ts', import.meta.url), module)
console.log(`\ntotal ${(total / 1024).toFixed(1)} KiB of PNG, ${(module.length / 1024).toFixed(1)} KiB of source`)