/* eslint-disable camelcase */

const { assert } = require('chai')
const { lookup, mock, mockConfig } = require('../../helpers')

const { Dispatcher } = lookup()

describe('unit | build/dispatcher', function() {
  describe('Dispatcher.findRepository', function() {
    it('ignores non push events', function() {
      mockConfig('watcher', {})
      mockConfig('webhooks', {})

      assert.equal(new Dispatcher().findRepository('foo'), null)
    })

    it('ignores non-branch, non-tag refs', function() {
      mockConfig('watcher', {})
      mockConfig('webhooks', {})

      let payload = {
        ref: 'refs/foos/bar',
        repository: {}
      }

      assert.equal(new Dispatcher().findRepository('push', payload), null)
    })

    it('ignores events when watcher and webhooks are disabled', function() {
      mockConfig('watcher', {})
      mockConfig('webhooks', {})

      let payload = {
        ref: 'refs/heads/mybranch',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.equal(new Dispatcher().findRepository('push', payload), null)
    })

    it('extracts info from branch push webhook', function() {
      mockConfig('watcher', {})
      mockConfig('webhooks', { enabled: true })

      let payload = {
        ref: 'refs/heads/mybranch',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.deepEqual(new Dispatcher().findRepository('push', payload), {
        name: 'repo',
        url: 'git@example.com:org/repo',
        refMode: 'branch',
        ref: 'mybranch'
      })
    })

    it('extracts info from tag push webhook', function() {
      mockConfig('watcher', {})
      mockConfig('webhooks', { enabled: true })

      let payload = {
        ref: 'refs/tags/mytag',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.deepEqual(new Dispatcher().findRepository('push', payload), {
        name: 'repo',
        url: 'git@example.com:org/repo',
        refMode: 'tag',
        ref: 'mytag'
      })
    })

    it('ignores events from non-watched repo', function() {
      mockConfig('watcher', { enabled: true, repositories: [] })
      mockConfig('webhooks', {})

      let payload = {
        ref: 'refs/heads/mybranch',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.equal(new Dispatcher().findRepository('push', payload), null)
    })

    it('ignores events from unknown branch in watched repo', function() {
      mockConfig('watcher', {
        enabled: true,
        repositories: [
          {
            url: 'git@example.com:org/repo',
            branches: ['branch1', 'branch2']
          }
        ]
      })
      mockConfig('webhooks', {})

      let payload = {
        ref: 'refs/heads/mybranch',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.equal(new Dispatcher().findRepository('push', payload), null)
    })

    it('returns info from known branch in watched repo', function() {
      mockConfig('watcher', {
        enabled: true,
        repositories: [
          {
            url: 'git@example.com:org/repo',
            branches: ['branch1', 'branch2']
          }
        ]
      })
      mockConfig('webhooks', {})

      let payload = {
        ref: 'refs/heads/branch1',
        repository: { ssh_url: 'git@example.com:org/repo' }
      }

      assert.deepEqual(new Dispatcher().findRepository('push', payload), {
        branches: ['branch1', 'branch2'],
        name: 'repo',
        url: 'git@example.com:org/repo',
        refMode: 'branch',
        ref: 'branch1'
      })
    })
  })

  describe('Dispatcher.dispatch', function() {
    it('does not do anything when findRepository returns null', async function() {
      let startBuildCalled

      mock('status', {
        startBuild() {
          startBuildCalled = true
        }
      })

      let dispatcher = new Dispatcher()
      dispatcher.findRepository = () => null
      await dispatcher.dispatch('push', {})

      assert.notOk(startBuildCalled)
    })

    it('starts a build and enqueues it when findRepository returns stuff', async function() {
      let buildCtorArgs, buildCalled, startBuildArgs, queuedFunction

      mock(
        'Build',
        class Build {
          constructor() {
            buildCtorArgs = [...arguments]
          }

          async build() {
            buildCalled = true
          }
        }
      )

      mock('status', {
        async startBuild() {
          startBuildArgs = [...arguments]
          return 'buildID'
        }
      })

      mock(
        'Queue',
        class Queue {
          run(fun) {
            queuedFunction = fun
          }
        }
      )

      let repoConfig = {
        name: 'repo',
        url: 'git@example.com:org/repo',
        refMode: 'branch',
        ref: 'mybranch'
      }

      let payload = { head_commit: { id: 'shashasha' } }

      let dispatcher = new Dispatcher()
      dispatcher.findRepository = () => repoConfig

      await dispatcher.dispatch('push', payload)

      assert.deepEqual(startBuildArgs, [
        'git@example.com:org/repo',
        'repo',
        'branch',
        'mybranch',
        'shashasha'
      ])
      assert.deepEqual(buildCtorArgs, ['buildID', payload, repoConfig])
      assert.ok(queuedFunction)
      await queuedFunction()
      assert.ok(buildCalled)
    })
  })
})
