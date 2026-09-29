import { promises } from './node-fs'

export const { readFile, readdir, stat, access, mkdir, writeFile } = promises
export default promises
