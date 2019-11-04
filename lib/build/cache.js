const { createHash } = require('crypto')
const { access, mkdir, readdir, readFile, stat, unlink } = require('fs-extra')
const { resolve } = require('path')
const { lookup, register, registerLazy } = require('../injections')

class Cache {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('cache')
    }
    return this._logger
  }

  get cacheDirectory() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'cache')
  }

  async _ensureCacheDirExists() {
    try {
      await mkdir(this.cacheDirectory, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }
  }

  async _getCacheFilename(repoName, repoRoot, entry) {
    let { logger } = this

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

  async _pruneCache() {
    let { cacheDirectory, logger } = this
    let {
      config: { cacheValidity, cacheMaxSize }
    } = lookup()

    let minMtime = Date.now() - cacheValidity
    let items = []

    for (let file of await readdir(cacheDirectory)) {
      let filePath = resolve(cacheDirectory, file)
      let fileStat = await stat(filePath)

      if (fileStat.mtimeMs < minMtime) {
        logger.debug(`removing expired ${file}`, { module: 'cache' })
        await unlink(filePath)
      } else {
        items.push({ file, mtime: fileStat.mtimeMs, size: fileStat.size })
      }
    }

    items.sort((a, b) => a.mtime - b.mtime)
    while (
      cacheMaxSize > 0
      && items.reduce((total, { size }) => total + size, 0) > cacheMaxSize
    ) {
      let { file } = items.shift()
      logger.debug(`removing ${file} to reduce cache size`, { module: 'cache' })
      await unlink(resolve(cacheDirectory, file))
    }
  }

  async restoreCache(repoName, repoRoot, cacheEntries) {
    let { cacheDirectory, logger } = this

    await this._ensureCacheDirExists()
    await this._pruneCache()

    let restored = []

    for (let entry of cacheEntries) {
      let cacheFilename = await this._getCacheFilename(
        repoName,
        repoRoot,
        entry
      )
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

      let { Tar } = lookup()
      await Tar.extract({
        cwd: repoRoot,
        file: tarball
      })

      restored.push(entry.path)
    }

    return restored
  }

  async saveCache(repoName, repoRoot, cacheEntries) {
    let { cacheDirectory, logger } = this

    await this._ensureCacheDirExists()

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

      let cacheFilename = await this._getCacheFilename(
        repoName,
        repoRoot,
        entry
      )
      if (!cacheFilename) {
        continue
      }

      let destination = resolve(cacheDirectory, cacheFilename)
      let fileExists = false
      try {
        await access(destination)
        fileExists = true
      } catch(e) {
        if (e.code !== 'ENOENT') {
          throw e
        }
      }

      if (fileExists) {
        logger.debug(
          `skipping save of ${entry.path}, ${cacheFilename} exists`,
          {
            module: `cache/${repoName}`
          }
        )
      } else {
        logger.debug(`saving ${entry.path} as ${cacheFilename}`, {
          module: `cache/${repoName}`
        })

        let { Tar } = lookup()
        await Tar.create({ cwd: repoRoot, file: destination }, [entry.path])

        saved.push(entry.path)
      }
    }

    return saved
  }
}

register(Cache)
registerLazy('cache', () => new Cache())
