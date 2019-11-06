/* eslint-disable camelcase */

const { assert } = require('chai')
const { src, mock, mockConfig, tempDir } = require('../helpers')
const Peon = require(`${src}/peon`)

describe('unit | peon', function() {
  beforeEach(async() => {
    let workingDirectory = await tempDir()
    mockConfig('workingDirectory', workingDirectory)
  })

  describe('status', function() {
    it('aborts stale builds on startup', async function() {
      let aborted = false

      mock('status', {
        async abortStaleBuilds() {
          aborted = true
        }
      })

      mock('renderer', {
        async render() {}
      })

      mockConfig('watcher', {
        enabled: false
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.ok(aborted)
    })
  })

  describe('renderer', function() {
    it('runs a render on startup', async function() {
      let rendered = false

      mock('status', {
        async abortStaleBuilds() {}
      })

      mock('renderer', {
        async render() {
          rendered = true
        }
      })

      mockConfig('watcher', {
        enabled: false
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.ok(rendered)
    })
  })

  describe('watchers', function() {
    it('starts a watcher for each configured repository', async function() {
      let watchers = []
      mock(
        'Watcher',
        class {
          constructor() {
            this.info = { args: [...arguments] }
            watchers.push(this.info)
          }
          on() {}
          start() {
            this.info.started = true
          }
        }
      )

      mock('renderer', {
        async render() {}
      })

      mockConfig('watcher', {
        enabled: true,
        repositories: [
          { url: 'url/to/repo1', branches: ['a', 'b'] },
          { url: 'url/to/repo2', branches: ['c', 'd'] }
        ]
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.deepEqual(watchers, [
        { args: ['repo1', 'url/to/repo1', ['a', 'b']], started: true },
        { args: ['repo2', 'url/to/repo2', ['c', 'd']], started: true }
      ])
    })

    it('plugs dispatcher to watcher change events', async function() {
      let handlers = {}
      mock(
        'Watcher',
        class {
          on(ev, handler) {
            handlers[ev] = handler
          }
          start() {}
        }
      )

      mock('renderer', {
        async render() {}
      })

      let dispatched
      mock('dispatcher', {
        dispatch() {
          dispatched = [...arguments]
        }
      })

      mockConfig('watcher', {
        enabled: true,
        repositories: [{ url: 'url/to/repo1', branches: ['a', 'b'] }]
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.ok(handlers.change)
      handlers.change('REF', 'SHA')

      assert.deepEqual(dispatched, [
        'push',
        {
          ref: 'REF',
          head_commit: { id: 'SHA' },
          repository: {
            ssh_url: 'url/to/repo1'
          }
        }
      ])
    })

    it('does not start watchers when disabled', async function() {
      let watchers = []
      mock(
        'Watcher',
        class {
          constructor() {
            watchers.push(this)
          }
        }
      )

      mock('renderer', {
        async render() {}
      })

      mockConfig('watcher', {
        enabled: false,
        repositories: [
          { url: 'url/to/repo1', branches: ['a', 'b'] },
          { url: 'url/to/repo2', branches: ['c', 'd'] }
        ]
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.deepEqual(watchers, [])
    })
  })

  describe('webhooks', function() {
    it('starts webhook server when enabled', async function() {
      let created, started
      mock(
        'WebhookServer',
        class {
          constructor() {
            created = true
          }
          on() {}
          start() {
            started = true
          }
        }
      )

      mock('renderer', {
        async render() {}
      })

      mockConfig('watcher', {
        enabled: false
      })

      mockConfig('webhooks', { enabled: true })

      await new Peon().start()

      assert.ok(created && started)
    })

    it('plugs dispatcher to webhooks server push events', async function() {
      let handlers = {}
      mock(
        'WebhookServer',
        class {
          on(ev, handler) {
            handlers[ev] = handler
          }
          start() {}
        }
      )

      mock('renderer', {
        async render() {}
      })

      let dispatched
      mock('dispatcher', {
        dispatch() {
          dispatched = [...arguments]
        }
      })

      mockConfig('watcher', {
        enabled: false
      })

      mockConfig('webhooks', { enabled: true })

      await new Peon().start()

      assert.ok(handlers.push)
      handlers.push('repo', 'data')

      assert.deepEqual(dispatched, ['push', 'data'])
    })

    it('does not start webhook server when disabled', async function() {
      let created
      mock(
        'WebhookServer',
        class {
          constructor() {
            created = true
          }
        }
      )

      mock('renderer', {
        async render() {}
      })

      mockConfig('watcher', {
        enabled: false
      })

      mockConfig('webhooks', { enabled: false })

      await new Peon().start()

      assert.notOk(created)
    })
  })
})
