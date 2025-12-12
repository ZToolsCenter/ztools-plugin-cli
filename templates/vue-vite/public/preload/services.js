const fs = require('node:fs')
const path = require('node:path')

window.services = {
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), `${Date.now()}.txt`)
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  writeImageFile(base64Url) {
    const matches = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matches) return
    const filePath = path.join(window.ztools.getPath('downloads'), `${Date.now()}.${matches[1]}`)
    fs.writeFileSync(filePath, base64Url.substring(matches[0].length), { encoding: 'base64' })
    return filePath
  }
}
