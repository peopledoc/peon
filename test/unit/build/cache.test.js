const { assert } = require('chai')
const { mkdir, readdir, utimes, writeFile } = require('fs-extra')
const { resolve } = require('path')
const crypto = require('crypto')
const { lookup, mock, mockConfig, tempDir } = require('../../helpers')

const { Cache } = lookup()

describe('unit | build/cache', function() {
  let workingDirectory

  beforeEach(async function() {
    workingDirectory = await tempDir()
    mockConfig('workingDirectory', workingDirectory)
  })

  describe('Cache._getCacheFilename', function() {
    it('returns nothing when key file does not exist', async function() {
      assert.equal(
        await new Cache()._getCacheFilename('myrepo', workingDirectory, {
          path: 'some/path/to/cache',
          source: 'nonexistingfile'
        }),
        undefined
      )
    })

    it('returns a filename based on key file content', async function() {
      let markerContent = 'some content'
      await writeFile(resolve(workingDirectory, 'markerfile'), markerContent)

      let sha = crypto
        .createHash('sha256')
        .update(markerContent)
        .digest('hex')

      let entry = {
        path: 'some/path/to/cache',
        source: 'markerfile'
      }

      assert.equal(
        await new Cache()._getCacheFilename('myrepo', workingDirectory, entry),
        `myrepo-some_path_to_cache-${sha}.tar`
      )

      assert.equal(entry.digest, sha)
    })

    it('does not recompute digest when already computed', async function() {
      let entry = {
        digest: 'somedigest',
        path: 'some/path/to/cache',
        source: 'markerfile'
      }

      assert.equal(
        await new Cache()._getCacheFilename('myrepo', workingDirectory, entry),
        'myrepo-some_path_to_cache-somedigest.tar'
      )
    })
  })

  describe('Cache._pruneCache', function() {
    it('removes expired entries', async function() {
      let validitySeconds = 60
      let expiredUnixTime = Date.now() / 1000 - validitySeconds * 2
      let validUnixTime = Date.now() / 1000 - validitySeconds / 2

      mockConfig('cacheValidity', validitySeconds * 1000)

      let cache = new Cache()
      await cache._ensureCacheDirExists()

      await writeFile(resolve(workingDirectory, 'cache', 'expired'), 'content')
      await utimes(
        resolve(workingDirectory, 'cache', 'expired'),
        expiredUnixTime,
        expiredUnixTime
      )
      await writeFile(resolve(workingDirectory, 'cache', 'valid1'), 'content')
      await utimes(
        resolve(workingDirectory, 'cache', 'valid1'),
        validUnixTime,
        validUnixTime
      )
      await writeFile(resolve(workingDirectory, 'cache', 'valid2'), 'content')

      await cache._pruneCache()

      assert.deepEqual(await readdir(resolve(workingDirectory, 'cache')), [
        'valid1',
        'valid2'
      ])
    })
  })

  describe('Cache.saveCache', function() {
    it('does nothing when no cache entries are present', async function() {
      assert.deepEqual(await new Cache().saveCache('myrepo', 'myroot', []), [])
    })

    it('does nothing when entry path does not exist', async function() {
      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')
      assert.deepEqual(
        await new Cache().saveCache('myrepo', workingDirectory, [
          {
            path: 'missingpath',
            source: 'existingkeyfile'
          }
        ]),
        []
      )
    })

    it('does nothing when key file does not exist', async function() {
      await mkdir(resolve(workingDirectory, 'existingpath'))
      assert.deepEqual(
        await new Cache().saveCache('myrepo', workingDirectory, [
          {
            path: 'existingpath',
            source: 'missingkeyfile'
          }
        ]),
        []
      )
    })

    it('does nothing when matching archive already exists', async function() {
      let cache = new Cache()
      let sha = crypto
        .createHash('sha256')
        .update('key')
        .digest('hex')

      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')

      await cache._ensureCacheDirExists()
      await writeFile(
        resolve(workingDirectory, 'cache', `myrepo-existingpath-${sha}.tar`),
        'dummy'
      )
      await mkdir(resolve(workingDirectory, 'existingpath'))

      assert.deepEqual(
        await cache.saveCache('myrepo', workingDirectory, [
          {
            path: 'existingpath',
            source: 'existingkeyfile'
          }
        ]),
        []
      )
    })

    it('creates cache archives', async function() {
      let tarCalls = []
      mock('Tar', {
        here: 'heeeere',
        create({ cwd, file }, paths) {
          tarCalls.push({ cwd, file, paths })
        }
      })

      let cache = new Cache()
      let sha = crypto
        .createHash('sha256')
        .update('key')
        .digest('hex')

      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')
      await mkdir(resolve(workingDirectory, 'existingpath'))

      assert.deepEqual(
        await cache.saveCache('myrepo', workingDirectory, [
          { path: 'existingpath', source: 'existingkeyfile' },
          { path: 'nonexistingpath', source: 'existingkeyfile' },
          { path: 'existingpath', source: 'nonexistingkeyfile' }
        ]),
        ['existingpath']
      )

      assert.deepEqual(tarCalls, [
        {
          cwd: workingDirectory,
          file: resolve(
            workingDirectory,
            'cache',
            `myrepo-existingpath-${sha}.tar`
          ),
          paths: ['existingpath']
        }
      ])
    })
  })

  describe('Cache.restoreCache', function() {
    it('does nothing when no cache entries are present', async function() {
      assert.deepEqual(
        await new Cache().restoreCache('myrepo', 'myroot', []),
        []
      )
    })

    it('does nothing when entry path does not exist', async function() {
      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')
      assert.deepEqual(
        await new Cache().restoreCache('myrepo', workingDirectory, [
          {
            path: 'missingpath',
            source: 'existingkeyfile'
          }
        ]),
        []
      )
    })

    it('does nothing when key file does not exist', async function() {
      await mkdir(resolve(workingDirectory, 'existingpath'))
      assert.deepEqual(
        await new Cache().restoreCache('myrepo', workingDirectory, [
          {
            path: 'existingpath',
            source: 'missingkeyfile'
          }
        ]),
        []
      )
    })

    it('does nothing when matching archive does not exists', async function() {
      let cache = new Cache()

      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')

      await cache._ensureCacheDirExists()
      await mkdir(resolve(workingDirectory, 'existingpath'))

      assert.deepEqual(
        await cache.restoreCache('myrepo', workingDirectory, [
          {
            path: 'existingpath',
            source: 'existingkeyfile'
          }
        ]),
        []
      )
    })

    it('extracts cache archives', async function() {
      let tarCalls = []
      mock('Tar', {
        here: 'heeeere',
        extract({ cwd, file }) {
          tarCalls.push({ cwd, file })
        }
      })

      let cache = new Cache()
      let sha = crypto
        .createHash('sha256')
        .update('key')
        .digest('hex')

      await cache._ensureCacheDirExists()
      await writeFile(
        resolve(workingDirectory, 'cache', `myrepo-existingpath-${sha}.tar`),
        'dummy'
      )

      await writeFile(resolve(workingDirectory, 'existingkeyfile'), 'key')
      await mkdir(resolve(workingDirectory, 'existingpath'))

      assert.deepEqual(
        await cache.restoreCache('myrepo', workingDirectory, [
          { path: 'existingpath', source: 'existingkeyfile' },
          { path: 'nonexistingpath', source: 'existingkeyfile' },
          { path: 'existingpath', source: 'nonexistingkeyfile' }
        ]),
        ['existingpath']
      )

      assert.deepEqual(tarCalls, [
        {
          cwd: workingDirectory,
          file: resolve(
            workingDirectory,
            'cache',
            `myrepo-existingpath-${sha}.tar`
          )
        }
      ])
    })
  })
})
