// electron-vite's Main asset import: the file is copied next to the bundle and the import is its absolute path.
declare module '*?asset' {
  const path: string
  export default path
}
