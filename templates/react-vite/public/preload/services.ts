import fs from 'node:fs'
import path from 'node:path'

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

declare global {
  interface Window {
    services: Services
  }
}

window.services = {
  readFile(file: string) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile(text: string) {
    const filePath = path.join(window.ztools.getPath('downloads'), `${Date.now()}.txt`)
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  writeImageFile(base64Url: string) {
    const matches = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matches) return
    const filePath = path.join(window.ztools.getPath('downloads'), `${Date.now()}.${matches[1]}`)
    fs.writeFileSync(filePath, base64Url.substring(matches[0].length), { encoding: 'base64' })
    return filePath
  }
}
