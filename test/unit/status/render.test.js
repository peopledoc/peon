const { assert } = require('chai')
const { mkdir, readFile, writeFile } = require('fs-extra')
const { resolve } = require('path')
const { lookup, mock, mockConfig, tempDir } = require('../../helpers')
const { Renderer } = lookup()

describe('unit | status/render', function() {
  let workingDirectory

  beforeEach(async function() {
    workingDirectory = await tempDir()
    mockConfig('workingDirectory', workingDirectory)
  })

  describe('Renderer.init', function() {
    it('registers a date helper', async function() {
      let helpers = {}
      mock('Handlebars', {
        compile() {},
        registerHelper(name, helper) {
          helpers[name] = helper
        }
      })

      let renderer = new Renderer()
      await renderer.init()

      assert.isFunction(helpers.date)

      let date = new Date('2001-02-03T04:05:06Z')
      assert.equal(helpers.date(Number(date)), '2001-02-03T04:05:06.000Z')
    })

    it('compiles templates', async function() {
      let renderer = new Renderer()
      await renderer.init()

      assert.isFunction(renderer.indexTemplate)
      assert.isFunction(renderer.buildTemplate)
    })
  })

  describe('Renderer._getLastRender', function() {
    it('returns 0 when no previous render was done', async function() {
      let renderer = new Renderer()
      assert.equal(await renderer._getLastRender(), 0)
      assert.equal(renderer.lastRender, 0)
    })

    it('returns last render date from saved JSON file', async function() {
      let renderer = new Renderer()

      await mkdir(resolve(workingDirectory, 'status'))
      await writeFile(
        resolve(workingDirectory, 'status', 'peon-status.json'),
        JSON.stringify({ lastRender: 1234 })
      )

      assert.equal(await renderer._getLastRender(), 1234)
      assert.equal(renderer.lastRender, 1234)
    })

    it('does not read JSON file again when last render is already known', async function() {
      let renderer = new Renderer()

      await mkdir(resolve(workingDirectory, 'status'))
      await writeFile(
        resolve(workingDirectory, 'status', 'peon-status.json'),
        'invalid json'
      )

      renderer.lastRender = 1234
      assert.equal(await renderer._getLastRender(), 1234)
      assert.equal(renderer.lastRender, 1234)
    })
  })

  describe('Renderer._setLastRender', function() {
    it('sets last render property and saves to JSON file', async function() {
      let renderer = new Renderer()
      await renderer._setLastRender(1234)
      assert.equal(renderer.lastRender, 1234)
      assert.deepEqual(
        JSON.parse(
          await readFile(
            resolve(workingDirectory, 'status', 'peon-status.json')
          )
        ),
        { lastRender: 1234 }
      )
    })
  })

  describe('Renderer._readReposStatus', function() {
    it('reads nothing when no status files are present', async function() {
      assert.deepEqual(await new Renderer()._readReposStatus(), {})
    })

    it('ignores peon-status.json', async function() {
      await mkdir(resolve(workingDirectory, 'status'))
      await writeFile(
        resolve(workingDirectory, 'status', 'peon-status.json'),
        'invalid json'
      )

      assert.deepEqual(await new Renderer()._readReposStatus(), {})
    })

    it('reads data from repo status files', async function() {
      await mkdir(resolve(workingDirectory, 'status'))
      await writeFile(
        resolve(workingDirectory, 'status', 'repo1.json'),
        JSON.stringify({
          data: { from: 'repo1' }
        })
      )
      await writeFile(
        resolve(workingDirectory, 'status', 'repo2.json'),
        JSON.stringify({
          data: { from: 'repo2' }
        })
      )

      assert.deepEqual(await new Renderer()._readReposStatus(), {
        repo1: { data: { from: 'repo1' } },
        repo2: { data: { from: 'repo2' } }
      })
    })
  })

  describe('Renderer._renderBuild', function() {
    let statusDirectory

    beforeEach(async function() {
      statusDirectory = await tempDir()
      mockConfig('statusDirectory', statusDirectory)
    })

    it('does not render a build when not updated since last render', async function() {
      let renderer = new Renderer()
      renderer.lastRender = 1234
      renderer.buildTemplate = function() {
        throw new Error('should not be called')
      }

      await renderer._renderBuild('repo#100', { updated: 1000 })
      assert.ok(true)
    })

    it('renders build when updated since last render', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
        return 'template render output'
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data'
      })

      assert.deepEqual(templateData, {
        buildId: 'repo#100',
        updated: 2000,
        data: 'some build data',
        isRunning: false
      })

      assert.equal(
        await readFile(resolve(statusDirectory, 'repo', '100.html')),
        'template render output'
      )
    })

    it('passes isRunning=true when build is pending', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data',
        status: 'pending'
      })

      assert.ok(templateData.isRunning)
    })

    it('passes isRunning=true when build is running', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data',
        status: 'running'
      })

      assert.ok(templateData.isRunning)
    })

    it('passes isRunning=false when build is successful', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data',
        status: 'success'
      })

      assert.notOk(templateData.isRunning)
    })

    it('passes isRunning=false when build is failed', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data',
        status: 'failed'
      })

      assert.notOk(templateData.isRunning)
    })

    it('passes isRunning=false when build is cancelled', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.lastRender = 1234
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      await renderer._renderBuild('repo#100', {
        updated: 2000,
        data: 'some build data',
        status: 'cancelled'
      })

      assert.notOk(templateData.isRunning)
    })
  })

  describe('Renderer._renderRepo', function() {
    it('calls _renderBuild for each build', async function() {
      let log = []
      let renderer = new Renderer()
      renderer._renderBuild = function() {
        log.push([...arguments])
      }

      await renderer._renderRepo({
        builds: {
          'repo#1': { data: 'build 1 data' },
          'repo#2': { data: 'build 2 data' }
        }
      })

      assert.deepEqual(log, [
        ['repo#1', { data: 'build 1 data' }],
        ['repo#2', { data: 'build 2 data' }]
      ])
    })
  })

  describe('Renderer._renderIndex', function() {
    let statusDirectory

    beforeEach(async function() {
      statusDirectory = await tempDir()
      mockConfig('statusDirectory', statusDirectory)
    })

    it('renders index', async function() {
      let renderer = new Renderer()
      renderer.indexTemplate = function() {
        return 'rendered template data'
      }

      await renderer._renderIndex(1, {})

      assert.equal(
        await readFile(resolve(statusDirectory, 'index.html')),
        'rendered template data'
      )
    })

    it('passes hasData=false when no repository data is available', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      await renderer._renderIndex(1, {})

      assert.notOk(templateData.hasData)
    })

    it('passes hasData=true when repository data is available', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      await renderer._renderIndex(1, { repo: { builds: {} } })

      assert.ok(templateData.hasData)
    })

    it('passes render date', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      await renderer._renderIndex(1234, { repo: { builds: {} } })

      assert.equal(templateData.now, 1234)
    })

    it('passes last 5 builds for each repository', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      await renderer._renderIndex(1, {
        repoA: {
          builds: {
            'repoA#1': { status: 'success' },
            'repoA#2': { status: 'success' },
            'repoA#3': { status: 'success' },
            'repoA#4': { status: 'failed' },
            'repoA#5': { status: 'success' },
            'repoA#6': { status: 'cancelled' },
            'repoA#7': { status: 'success' },
            'repoA#8': { status: 'failed' },
            'repoA#9': { status: 'success' },
            'repoA#10': { status: 'success' },
            'repoA#11': { status: 'success' }
          }
        },
        repoB: {
          builds: {
            'repoB#1': { status: 'failed' }
          }
        }
      })

      assert.deepEqual(templateData.repos.repoA.lastBuilds, [
        { buildId: 'repoA#11', link: 'repoA/11.html', status: 'success' },
        { buildId: 'repoA#10', link: 'repoA/10.html', status: 'success' },
        { buildId: 'repoA#9', link: 'repoA/9.html', status: 'success' },
        { buildId: 'repoA#8', link: 'repoA/8.html', status: 'failed' },
        { buildId: 'repoA#7', link: 'repoA/7.html', status: 'success' }
      ])

      assert.deepEqual(templateData.repos.repoB.lastBuilds, [
        { buildId: 'repoB#1', link: 'repoB/1.html', status: 'failed' }
      ])
    })

    it('passes last successful build for each ref for each repo, sorting refs by name, master first', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      await renderer._renderIndex(1, {
        repoA: {
          builds: {
            'repoA#1': { id: 1, status: 'success', branch: 'master' },
            'repoA#2': { id: 2, status: 'success', tag: 'mytag' },
            'repoA#3': { id: 3, status: 'success', branch: 'abranch' },
            'repoA#4': { id: 4, status: 'failed', branch: 'master' },
            'repoA#5': { id: 5, status: 'success', tag: 'atag' },
            'repoA#6': { id: 6, status: 'cancelled', tag: 'atag' },
            'repoA#7': { id: 7, status: 'success', branch: 'mybranch' },
            'repoA#8': { id: 8, status: 'failed', branch: 'master' },
            'repoA#9': { id: 9, status: 'success', branch: 'mybranch' },
            'repoA#10': { id: 10, status: 'success', tag: 'atag' },
            'repoA#11': { id: 11, status: 'success', tag: 'mytag' }
          }
        }
      })

      assert.deepEqual(
        templateData.repos.repoA.lastSuccessfulBuildByRef.map((b) => b.id),
        [1, 3, 10, 9, 11]
      )
    })
  })

  describe('Renderer.render', function() {
    it('loads repo status, renders builds, renders index and updates last render', async function() {
      let log = []
      let renderer = new Renderer()

      renderer._readReposStatus = async function() {
        log.push('read status')
        return { repo1: 'repo 1 data', repo2: 'repo 2 data' }
      }
      renderer._renderRepo = async function(status) {
        log.push(`render with ${status}`)
      }
      renderer._renderIndex = async function(now, status) {
        assert.equal(now, 1234)
        assert.deepEqual(status, { repo1: 'repo 1 data', repo2: 'repo 2 data' })
        log.push('render index')
      }
      renderer._setLastRender = async function(now) {
        assert.equal(now, 1234)
        log.push('set last render')
      }

      await renderer.render(1234)

      assert.deepEqual(log, [
        'read status',
        'render with repo 1 data',
        'render with repo 2 data',
        'render index',
        'set last render'
      ])
    })
  })
})
