import fs from 'fs'
import path from 'path'

function readVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string }
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

export const VERSION = readVersion()
