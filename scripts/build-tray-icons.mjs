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

// The app mark's owl (assets/ses-agent-logo.svg) on its 64-unit grid: the head is solid, the eyes are cut out
// (the overlap between them stays solid, as it is white in the colour mark) and the pupils stay solid.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path fill="#000" d="M12.7 20.3C10.2 18.2 9.4 14.5 10.5 10.8C13.6 13.4 17 14.6 20.6 15.2Z"/>
  <path fill="#000" d="M51.3 20.3C53.8 18.2 54.6 14.5 53.5 10.8C50.4 13.4 47 14.6 43.4 15.2Z"/>
  <path fill="#000" fill-rule="evenodd" d="M7.9 32.8a24.1 20.8 0 1 0 48.2 0a24.1 20.8 0 1 0-48.2 0Z
    M11.15 32.6a11.8 11.8 0 1 0 23.6 0a11.8 11.8 0 1 0-23.6 0Z
    M29.25 32.6a11.8 11.8 0 1 0 23.6 0a11.8 11.8 0 1 0-23.6 0Z
    M17.1 32.8a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0-9.6 0Z
    M37.3 32.8a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0-9.6 0Z"/>
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
// The tile follows the macOS grid: 824 of 1024.
const inset = Math.round((metadata.width ?? 1024) * (100 / 1024))
const tile = await sharp(source)
  .extract({ left: inset, top: inset, width: (metadata.width ?? 1024) - inset * 2, height: (metadata.height ?? 1024) - inset * 2 })
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
