/* eslint-disable camelcase */

const { assert } = require('chai')
const { readFile } = require('fs-extra')
const { resolve } = require('path')
const { lookup, mock, mockConfig, tempDir, wait, waitUntil } = require('../../helpers')
const { Renderer } = lookup()

describe('unit | status/render', function() {
  let statusDirectory

  beforeEach(async function() {
    statusDirectory = await tempDir()
    mockConfig('statusDirectory', statusDirectory)
  })

  describe('Renderer._init', function() {
    it('registers handlebars helpers', async function() {
      let helpers = {}
      mock('Handlebars', {
        compile() {},
        registerHelper(name, helper) {
          helpers[name] = helper
        }
      })

      let renderer = new Renderer()
      await renderer._init()

      assert.isFunction(helpers.date)
      assert.equal(
        helpers.date(Number(new Date('2001-02-03T04:05:06Z'))),
        '2001-02-03T04:05:06.000Z'
      )

      assert.isFunction(helpers.shortsha)
      assert.equal(helpers.shortsha('abcdefghijkl'), 'abcdefgh')

      assert.isFunction(helpers.time)
      assert.equal(helpers.time(null), '')
      assert.equal(helpers.time(50), '50ms')
      assert.equal(helpers.time(5678), '5.7s')
      assert.equal(helpers.time(67890), '1m07s')
    })

    it('compiles templates', async function() {
      let renderer = new Renderer()
      await renderer._init()

      assert.isFunction(renderer.indexTemplate)
      assert.isFunction(renderer.buildTemplate)
      assert.isFunction(renderer.buildredirTemplate)
      assert.isFunction(renderer.repoTemplate)
    })
  })

  describe('Renderer._renderBuild', function() {

    it('renders build', async function() {
      let renderer = new Renderer()
      let templateData

      mock('db', {
        async getSteps(id) {
          assert.equal(id, 100)
          return [
            { step: 'step1', start: 100, end: 200 },
            { step: 'step2', start: 100 }
          ]
        }
      })

      renderer.buildTemplate = function(data) {
        templateData = data
        return 'template render output'
      }

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        enqueued: 500,
        start: 1000,
        end: 2000
      })

      assert.deepEqual(templateData, {
        id: 100,
        data: 'some build data',
        enqueued: 500,
        start: 1000,
        end: 2000,

        is_running: false,
        queue_time: 500,
        run_time: 1000,
        repo_link: 'repo.html',
        repo_name: 'repo',
        build_link: '100.html',

        steps: [
          { step: 'step1', start: 100, end: 200, duration: 100 },
          { step: 'step2', start: 100, duration: null }
        ]
      })

      assert.equal(
        await readFile(resolve(statusDirectory, '100.html')),
        'template render output'
      )
    })

    it('passes is_running=true when build is pending', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'pending'
      })

      assert.ok(templateData.is_running)
    })

    it('passes is_running=true when build is running', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'running'
      })

      assert.ok(templateData.is_running)
    })

    it('passes is_running=false when build is successful', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'success'
      })

      assert.notOk(templateData.is_running)
    })

    it('passes is_running=false when build is failed', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'failed'
      })

      assert.notOk(templateData.is_running)
    })

    it('passes is_running=false when build is cancelled', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.buildTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'cancelled'
      })

      assert.notOk(templateData.is_running)
    })

    it('renders redirection template when build has extra.oldBuildID', async function() {
      let renderer = new Renderer()
      let templateData

      renderer.buildTemplate = function() {}
      renderer.buildredirTemplate = function(data) {
        templateData = data
        return 'redirection page'
      }

      mock('db', {
        async getSteps() {
          return []
        }
      })

      await renderer._renderBuild({ name: 'repo' }, {
        id: 100,
        data: 'some build data',
        status: 'cancelled',
        extra: {
          oldBuildID: 'repo#12345'
        }
      })

      assert.deepEqual(templateData, { id: 100 })

      assert.equal(
        await readFile(resolve(statusDirectory, 'repo/12345.html')),
        'redirection page'
      )
    })
  })

  describe('Renderer._renderRepo', function() {
    it('calls _renderBuild for each build and renders repo page', async function() {
      let log = []
      let renderer = new Renderer()
      let templateData

      renderer._renderBuild = function() {
        log.push([...arguments])
      }

      renderer.repoTemplate = function(data) {
        templateData = data
        return 'rendered template'
      }

      let now = Date.now()
      renderer.lastRender = now - 1000

      mock('db', {
        async getBuilds() {
          return  [
            {
              id: 2,
              data: 'build 2 data',
              ref_type: 'tag',
              ref: 'mytag',
              updated: now + 1
            },
            {
              id: 1,
              data: 'build 1 data',
              ref_type: 'branch',
              ref: 'mybranch',
              updated: now
            }
          ]
        }
      })

      await renderer._renderRepo(now, { id: 1, name: 'repo' })

      assert.deepEqual(templateData, {
        builds: [
          {
            id: 2,
            data: 'build 2 data',
            ref: 'mytag',
            ref_type: 'tag',
            updated: now + 1,
            run_time: null,
            build_link: '2.html',
            queue_time: null
          },
          {
            id: 1,
            data: 'build 1 data',
            ref: 'mybranch',
            ref_type: 'branch',
            updated: now,
            run_time: null,
            build_link: '1.html',
            queue_time: null
          }
        ],
        now,
        repo_name: 'repo'
      })

      assert.equal(
        await readFile(resolve(statusDirectory, 'repo.html')),
        'rendered template'
      )

      assert.deepEqual(log, [
        [
          { id: 1, name: 'repo' },
          { id: 2, data: 'build 2 data', ref: 'mytag', ref_type: 'tag', updated: now + 1 }
        ],
        [
          { id: 1, name: 'repo' },
          { id: 1, data: 'build 1 data', ref: 'mybranch', ref_type: 'branch', updated: now }
        ]
      ])
    })
  })

  describe('Renderer._renderIndex', function() {
    it('renders index', async function() {
      let renderer = new Renderer()

      renderer.indexTemplate = function() {
        return 'rendered template data'
      }

      mock('db', {
        async getLastUpdatedBuilds() {
          return []
        }
      })

      await renderer._renderIndex(1)

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

      mock('db', {
        async getLastUpdatedBuilds() {
          return []
        }
      })

      await renderer._renderIndex(1)

      assert.notOk(templateData.hasData)
    })

    it('passes hasData=true when repository data is available', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getLastUpdatedBuilds() {
          return [{ repo_name: 'repo', updated: 100 }]
        }
      })

      await renderer._renderIndex(1)

      assert.ok(templateData.hasData)
    })

    it('passes render date', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }

      mock('db', {
        async getLastUpdatedBuilds() {
          return []
        }
      })

      await renderer._renderIndex(1234)

      assert.equal(templateData.now, 1234)
    })

    it('passes last builds', async function() {
      let renderer = new Renderer()
      let templateData
      renderer.indexTemplate = function(data) {
        templateData = data
      }
      renderer.indexBuildCount = 5

      mock('db', {
        async getLastUpdatedBuilds() {
          return [
            { id: 1, updated: 100 },
            { id: 2, updated: 99 },
            { id: 3, updated: 98 },
            { id: 4, updated: 97 },
            { id: 5, updated: 96 }
          ]
        }
      })

      await renderer._renderIndex(1)

      assert.deepEqual(templateData.builds.map((b) => b.id), [1, 2, 3, 4, 5])
    })

    it('does not render when no build was updated', async function() {
      let renderer = new Renderer()
      let rendered = false

      renderer.lastRender = 200
      renderer.indexTemplate = function() {
        rendered = true
      }

      mock('db', {
        async getLastUpdatedBuilds() {
          return [
            { id: 1, updated: 100 },
            { id: 2, updated: 99 },
            { id: 3, updated: 98 },
            { id: 4, updated: 97 },
            { id: 5, updated: 96 }
          ]
        }
      })

      await renderer._renderIndex(1)

      assert.notOk(rendered)
    })
  })

  describe('Renderer._render', function() {
    it('loads repos, renders each repo, renders index, sets rendering to false', async function() {
      let log = []
      let renderer = new Renderer()

      mock('db', {
        async getRepos() {
          log.push('fetch repos')

          return [
            { id: 1, name: 'repo 1' },
            { id: 2, name: 'repo 2' }
          ]
        }
      })

      renderer._renderRepo = async function(now, repo) {
        assert.closeTo(now, Date.now(), 500)
        log.push(`render with ${repo.name}`)
      }

      renderer._renderIndex = async function(now) {
        assert.closeTo(now, Date.now(), 500)
        log.push('render index')
      }

      renderer.rendering = true
      await renderer._render()

      assert.notOk(renderer.rendering)

      assert.deepEqual(log, [
        'fetch repos',
        'render with repo 1',
        'render with repo 2',
        'render index'
      ])
    })

    it('renders again when shouldRefresh is marked', async function() {
      let log = []
      let renderer = new Renderer()

      mock('db', {
        async getRepos() {
          log.push('fetch repos')

          return [
            { id: 1, name: 'repo 1' },
            { id: 2, name: 'repo 2' }
          ]
        }
      })

      renderer._renderRepo = async function(now, repo) {
        assert.closeTo(now, Date.now(), 500)
        log.push(`render with ${repo.name}`)
      }

      renderer._renderIndex = async function(now) {
        assert.closeTo(now, Date.now(), 500)
        log.push('render index')
      }

      renderer.shouldRefresh = true
      await renderer._render()

      assert.deepEqual(log, [
        'fetch repos',
        'render with repo 1',
        'render with repo 2',
        'render index',
        'fetch repos',
        'render with repo 1',
        'render with repo 2',
        'render index'
      ])

      assert.notOk(renderer.shouldRefresh)
    })
  })

  describe('Renderer.render', function() {
    it('queues an additional render when rendering is already in progress', async function() {
      let renderer = new Renderer()

      let renderEntered = 0
      let renderExited = 0
      let renderCanResolve = false

      renderer._render = async function() {
        renderEntered++
        await waitUntil(() => renderCanResolve)
        this.rendering = false
        renderExited++
      }

      renderer.render()
      await wait(20)

      renderer.render()
      await wait(20)

      renderer.render()
      await wait(20)

      renderer.render()
      await wait(20)

      renderCanResolve = true
      await waitUntil(() => renderExited === renderEntered)

      assert.equal(renderEntered, 1)
      assert.ok(renderer.shouldRefresh)

      renderer.render()
      await wait(20)
      await waitUntil(() => renderExited === renderEntered)

      assert.equal(renderEntered, 2)
    })
  })
})
