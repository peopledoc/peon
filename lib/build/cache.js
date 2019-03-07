const { createHash } = require('crypto')
const { access, mkdir, readdir, readFile, stat, unlink } = require('fs-extra')
const { resolve } = require('path')
const Tar = require('tar')

const { workingDirectory, cacheValidity } = require('../config')
const logger = require('../utils/logger')('cache')

const cacheDirectory = resolve(workingDirectory, 'cache')

async function ensureCacheDirExists() {
  try {
    await mkdir(cacheDirectory, { recursive: true })
  } catch(e) {
    if (e.code !== 'EEXIST') {
      throw e
    }
  }
}

async function getCacheFilename(repoName, repoRoot, entry) {
  if (!entry.digest) {
    let keyFile = resolve(repoRoot, entry.source)
    let keyHash = createHash('sha256')

    try {
      keyHash.update(await readFile(keyFile))
    } catch(e) {
      logger.debug(`could not read key file ${entry.source}`, {
        module: `cache/${repoName}`
      })
      return
    }

    entry.digest = keyHash.digest('hex')
  }

  let cleanPath = entry.path.replace(/\//g, '_')
  return `${repoName}-${cleanPath}-${entry.digest}.tar`
}

async function pruneCache() {
  let minMtime = Date.now() - cacheValidity

  for (let file of await readdir(cacheDirectory)) {
    let filePath = resolve(cacheDirectory, file)
    let fileStat = await stat(filePath)
    if (fileStat.mtimeMs < minMtime) {
      logger.debug(`removing expired ${file}`, { module: 'cache' })
      await unlink(filePath)
    }
  }
}

async function restoreCache(repoName, repoRoot, cacheEntries) {
  await ensureCacheDirExists()
  await pruneCache()

  let restored = []

  for (let entry of cacheEntries) {
    let cacheFilename = await getCacheFilename(repoName, repoRoot, entry)
    if (!cacheFilename) {
      continue
    }

    let tarball = resolve(cacheDirectory, cacheFilename)
    try {
      await access(tarball)
    } catch(e) {
      if (e.code === 'ENOENT') {
        logger.debug(
          `tarball ${cacheFilename} not found, ${
            entry.path
          } will not be restored`,
          {
            module: `cache/${repoName}`
          }
        )
        continue
      }

      throw e
    }

    logger.debug(`restoring ${entry.path} from ${cacheFilename}`, {
      module: `cache/${repoName}`
    })

    await Tar.extract({
      cwd: repoRoot,
      file: tarball
    })

    restored.push(entry.path)
  }

  return restored
}

async function saveCache(repoName, repoRoot, cacheEntries) {
  await ensureCacheDirExists()

  let saved = []

  for (let entry of cacheEntries) {
    try {
      await access(resolve(repoRoot, entry.path))
    } catch(e) {
      if (e.code === 'ENOENT') {
        logger.debug(`path ${entry.path} not found, will not be saved`, {
          module: `cache/${repoName}`
        })
        continue
      }

      throw e
    }

    let cacheFilename = await getCacheFilename(repoName, repoRoot, entry)
    if (!cacheFilename) {
      continue
    }

    let fileExists = false
    try {
      await access(cacheFilename)
      fileExists = true
    } catch(e) {
      if (e.code !== 'ENOENT') {
        throw e
      }
    }

    if (fileExists) {
      logger.debug(`skipping save of ${entry.path}, ${cacheFilename} exists`, {
        module: `cache/${repoName}`
      })
    } else {
      logger.debug(`saving ${entry.path} as ${cacheFilename}`, {
        module: `cache/${repoName}`
      })

      let destination = resolve(cacheDirectory, cacheFilename)
      await Tar.create({ cwd: repoRoot, file: destination }, [entry.path])

      saved.push(entry.path)
    }
  }

  return saved
}

module.exports = { saveCache, restoreCache }
