import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

/**
 * Menu-bar / system-tray icons, committed under assets/tray and bundled by the Main build:
 * - macOS: a monochrome template glyph (black on transparent, 18pt @1x and @2x) that the menu bar tints;
 * - Windows: tray.ico, the app icon (assets/sesai-app-icon.png) cropped to its tile at 16/20/24/32/48 px.
 */
const outputDirectory = resolve('assets/tray')
await mkdir(outputDirectory, { recursive: true })

// The app mark's two interlocking strokes, drawn on an 18-unit grid.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">
  <path fill="#000" d="M13.6 2.6C10.2 1.2 5.6 2 4 4.7c-1.3 2.2.1 4.2 2.4 5.2l2.7 1.2c.2-1.1-.5-2-1.6-2.6L6.4 7.8c-.9-.5-1.2-1.4-.7-2.2 1-1.7 4.3-2.6 7.9-3z"/>
  <path fill="#000" d="M4.4 15.4c3.4 1.4 8 .6 9.6-2.1 1.3-2.2-.1-4.2-2.4-5.2L8.9 6.9c-.2 1.1.5 2 1.6 2.6l1.1.7c.9.5 1.2 1.4.7 2.2-1 1.7-4.3 2.6-7.9 3z"/>
</svg>`

for (const [name, size] of [
  ['trayTemplate.png', 18],
  ['trayTemplate@2x.png', 36]
]) {
  await sharp(Buffer.from(glyph), { density: 72 * (size / 18) * 4 })
    .resize(size, size)
    .png()
    .toFile(resolve(outputDirectory, name))
}

// The app icon's tile sits inside transparent padding; crop to it so the tray shows the mark, not the margin.
const source = resolve('assets/sesai-app-icon.png')
const metadata = await sharp(source).metadata()
const inset = Math.round((metadata.width ?? 1254) * 0.135)
const tile = await sharp(source)
  .extract({ left: inset, top: inset, width: (metadata.width ?? 1254) - inset * 2, height: (metadata.height ?? 1254) - inset * 2 })
  .png()
  .toBuffer()
const sizes = [16, 20, 24, 32, 48]
const images = await Promise.all(sizes.map((size) => sharp(tile).resize(size, size).png().toBuffer()))

// ICO container with PNG-compressed entries (supported since Windows Vista).
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
const directory = Buffer.alloc(16 * images.length)
let offset = header.length + directory.length
images.forEach((image, index) => {
  const size = sizes[index]
  const entry = index * 16
  directory.writeUInt8(size >= 256 ? 0 : size, entry)
  directory.writeUInt8(size >= 256 ? 0 : size, entry + 1)
  directory.writeUInt8(0, entry + 2)
  directory.writeUInt8(0, entry + 3)
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(image.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += image.length
})
await writeFile(resolve(outputDirectory, 'tray.ico'), Buffer.concat([header, directory, ...images]))

process.stdout.write(`${outputDirectory}\n`)
