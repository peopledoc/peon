const { assert } = require('chai')
const { ensureDir, readFile, pathExists, writeFile } = require('fs-extra')
const { resolve } = require('path')
const { lookup, mock, mockConfig, tempDir } = require('../../helpers')

const { Cleanup } = lookup()

describe('unit | cleanup/cleanup', function() {
  let workingDirectory

  beforeEach(async function() {
    workingDirectory = await tempDir()
    mockConfig('workingDirectory', workingDirectory)
  })

  describe('Cleanup._getCleanupData', function() {
    it('reads cleanup data from JSON files', async function() {
      await ensureDir(resolve(workingDirectory, 'cleanup'))
      await writeFile(
        resolve(workingDirectory, 'cleanup', 'reponame.json'),
        JSON.stringify({ some: { json: 'data' } })
      )

      assert.deepEqual(await new Cleanup()._getCleanupData('reponame'), {
        some: { json: 'data' }
      })
    })

    it('returns an empty array when no cleanup data is available', async function() {
      assert.deepEqual(await new Cleanup()._getCleanupData('reponame'), [])
    })
  })

  describe('Cleanup._setCleanupData', function() {
    it('writes cleanup data as JSON', async function() {
      await new Cleanup()._setCleanupData('reponame', {
        some: { json: 'data' }
      })

      assert.deepEqual(
        JSON.parse(
          await readFile(resolve(workingDirectory, 'cleanup', 'reponame.json'))
        ),
        { some: { json: 'data' } }
      )
    })
  })

  describe('Cleanup.registerForCleanup', function() {
    it('appends new cleanup data', async function() {
      let cleanup = new Cleanup()
      let setArgs

      cleanup._getCleanupData = function() {
        return [{ existing: 'data' }]
      }
      cleanup._setCleanupData = function() {
        setArgs = [...arguments]
      }

      await cleanup.registerForCleanup(
        'reponame',
        'refMode',
        'ref',
        'buildId',
        'destination',
        'pathInDestination'
      )

      assert.deepEqual(setArgs, [
        'reponame',
        [
          { existing: 'data' },
          {
            refMode: 'refMode',
            ref: 'ref',
            buildIDs: ['buildId'],
            destination: 'destination',
            pathInDestination: 'pathInDestination'
          }
        ]
      ])
    })

    it('appends new build ID when cleanup data exists for that ref', async function() {
      let cleanup = new Cleanup()

      cleanup._getCleanupData = function() {
        return [
          {
            refMode: 'refMode',
            ref: 'ref',
            buildIDs: ['buildId'],
            destination: 'destination',
            pathInDestination: 'pathInDestination'
          }
        ]
      }

      let setArgs
      cleanup._setCleanupData = function() {
        setArgs = [...arguments]
      }

      await cleanup.registerForCleanup(
        'reponame',
        'refMode',
        'ref',
        'newBuildId',
        'destination',
        'pathInDestination'
      )

      assert.deepEqual(setArgs, [
        'reponame',
        [
          {
            refMode: 'refMode',
            ref: 'ref',
            buildIDs: ['buildId', 'newBuildId'],
            destination: 'destination',
            pathInDestination: 'pathInDestination'
          }
        ]
      ])
    })
  })

  describe('Cleanup.cleanup', function() {
    it('removes local build and cleanup data', async function() {
      let setArgs, markCleanupArgs
      let cleanup = new Cleanup()
      let dest = await tempDir()

      cleanup._getCleanupData = function() {
        return [
          { other: 'data' },
          {
            refMode: 'refMode',
            ref: 'ref',
            buildIDs: ['buildId'],
            destination: dest,
            pathInDestination: 'path/in/destination'
          }
        ]
      }

      cleanup._setCleanupData = function() {
        setArgs = [...arguments]
      }

      mock('status', {
        markCleanup() {
          markCleanupArgs = [...arguments]
        }
      })

      await ensureDir(resolve(dest, 'path/in/destination'))
      await writeFile(resolve(dest, 'path/in/destination/file'), 'content')

      assert.ok(await cleanup.cleanup('reponame', 'refMode', 'ref'))
      assert.notOk(await pathExists(resolve(dest, 'path/in/destination')))
      assert.deepEqual(setArgs, ['reponame', [{ other: 'data' }]])
      assert.deepEqual(markCleanupArgs, ['buildId'])
    })

    it('does nothing when no cleanup data is found', async function() {
      let cleanup = new Cleanup()

      cleanup._getCleanupData = function() {
        return [{ other: 'data' }]
      }

      assert.notOk(await cleanup.cleanup('reponame', 'refMode', 'ref'))
    })

    it('fails silently when directory to remove is not there', async function() {
      let markCleanupArgs, setArgs
      let cleanup = new Cleanup()

      cleanup._getCleanupData = async function() {
        return [
          {
            refMode: 'refMode',
            ref: 'ref',
            buildIDs: ['buildId'],
            destination: await tempDir(),
            pathInDestination: 'path/in/destination'
          }
        ]
      }

      cleanup._setCleanupData = function() {
        setArgs = [...arguments]
      }

      mock('status', {
        markCleanup() {
          markCleanupArgs = [...arguments]
        }
      })

      assert.ok(await cleanup.cleanup('reponame', 'refMode', 'ref'))
      assert.deepEqual(setArgs, ['reponame', []])
      assert.deepEqual(markCleanupArgs, ['buildId'])
    })
  })
})
