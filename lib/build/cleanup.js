const { resolve } = require('path')
const { ensureDir, readFile, remove, writeFile } = require('fs-extra')

const { lookup, register, registerLazy } = require('../injections')

class Cleanup {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('cleanup')
    }
    return this._logger
  }

  get cleanupDirectory() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'cleanup')
  }

  async _getCleanupData(repoName) {
    let { cleanupDirectory } = this

    await ensureDir(cleanupDirectory)
    try {
      return JSON.parse(
        await readFile(resolve(cleanupDirectory, `${repoName}.json`))
      )
    } catch(e) {
      return []
    }
  }

  async _setCleanupData(repoName, cleanupData) {
    let { cleanupDirectory } = this

    await ensureDir(cleanupDirectory)
    await writeFile(
      resolve(cleanupDirectory, `${repoName}.json`),
      JSON.stringify(cleanupData)
    )
  }

  async registerForCleanup(
    repoName,
    refMode,
    ref,
    buildId,
    destination,
    pathInDestination
  ) {
    let cleanupData = await this._getCleanupData(repoName)

    let item = cleanupData.find((d) => d.refMode === refMode && d.ref === ref)

    if (!item) {
      item = {
        refMode,
        ref,
        destination,
        pathInDestination,
        buildIDs: []
      }

      cleanupData.push(item)
    }

    item.buildIDs.push(buildId)

    await this._setCleanupData(repoName, cleanupData)
  }

  async cleanup(repoName, refMode, ref) {
    let { logger } = this
    let loggerOpts = { module: `cleanup/${repoName}` }

    let cleanupData = await this._getCleanupData(repoName)

    let cleanup = cleanupData.find(
      (d) => d.refMode === refMode && d.ref === ref
    )

    if (!cleanup) {
      logger.debug(`found no cleanup info for ${refMode} ${ref}`, loggerOpts)
      return false
    } else {
      let { destination, pathInDestination } = cleanup

      let toRemove = resolve(destination, pathInDestination)

      logger.debug(`removing local directory ${toRemove}`, loggerOpts)

      await remove(toRemove)

      logger.info(
        `removed build for ${refMode} ${ref} on ${repoName}`,
        loggerOpts
      )

      let { status } = lookup()
      for (let buildId of cleanup.buildIDs) {
        await status.markCleanup(buildId)
      }

      cleanupData.splice(cleanupData.indexOf(cleanup), 1)
      await this._setCleanupData(repoName, cleanupData)

      return true
    }
  }
}

register(Cleanup)
registerLazy('cleanup', () => new Cleanup())
