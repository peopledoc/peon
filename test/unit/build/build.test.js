/* eslint-disable camelcase */

const { assert } = require('chai')
const { ensureDir, readFile, stat, writeFile } = require('fs-extra')
const yaml = require('js-yaml')
const { resolve } = require('path')
const {
  lookup,
  mock,
  mockConfig,
  root,
  tempDir,
  wait
} = require('../../helpers')

const { Build, BuildWarning, CancelBuild, Environment } = lookup()

describe('unit | build/build', function() {
  describe('Build._runStep', function() {
    let stepLog

    beforeEach(() => (stepLog = []))

    async function runStep(step) {
      mock('status', {
        updateBuildStep(build, step, status, output) {
          stepLog.push({ build, step, status, output })
        }
      })

      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})
      await build._runStep('mystep', step)
    }

    it('runs step and updates build status', async function() {
      await runStep(async() => {
        stepLog.push('step start')
        wait(20)
        stepLog.push('step end')
      })

      assert.deepEqual(stepLog, [
        {
          build: 'ID',
          output: undefined,
          status: 'running',
          step: 'mystep'
        },
        'step start',
        'step end',
        {
          build: 'ID',
          output: undefined,
          status: 'success',
          step: 'mystep'
        }
      ])
    })

    it('updates build status with step output', async function() {
      await runStep(async() => {
        wait(20)
        return 'step output'
      })

      assert.equal(stepLog.pop().output, 'step output')
    })

    it('updates build status with output during step execution', async function() {
      await runStep(async(updateOutput) => {
        wait(20)
        updateOutput('partial output')
        wait(20)
        return 'final output'
      })

      assert.deepEqual(stepLog, [
        {
          build: 'ID',
          output: undefined,
          status: 'running',
          step: 'mystep'
        },
        {
          build: 'ID',
          output: 'partial output',
          status: 'running',
          step: 'mystep'
        },
        {
          build: 'ID',
          output: 'final output',
          status: 'success',
          step: 'mystep'
        }
      ])
    })

    it('sets step status as failed when step throws a BuildWarning', async function() {
      await runStep(async() => {
        wait(20)
        throw new BuildWarning(new Error('oopsie!'))
      })

      assert.deepEqual(stepLog.pop(), {
        build: 'ID',
        output: 'oopsie!',
        status: 'failed',
        step: 'mystep'
      })
    })

    it('sets step status as failed and throws when step throws an error', async function() {
      try {
        await runStep(async() => {
          wait(20)
          throw new Error('oopsie!')
        })
        assert.ok(false)
      } catch(e) {
        assert.ok(true)
      }

      assert.deepEqual(stepLog.pop(), {
        build: 'ID',
        output: 'oopsie!',
        status: 'failed',
        step: 'mystep'
      })
    })
  })

  describe('Build._updateRepository', function() {
    let workingDirectory

    beforeEach(async function() {
      workingDirectory = await tempDir()
      mockConfig('workingDirectory', workingDirectory)
    })

    it('opens and fetches origin when a local clone exists', async function() {
      let openPath, fetchRemote
      mock('Git', {
        Repository: {
          open(path) {
            openPath = path
            return {
              fetch(remote) {
                fetchRemote = remote
              }
            }
          }
        }
      })

      await new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )._updateRepository()

      assert.equal(openPath, `${workingDirectory}/repos/reponame`)
      assert.equal(fetchRemote, 'origin')
    })

    it('clones the repository when a local clone does not exist', async function() {
      let log = []

      mock('Git', {
        Clone(url, path) {
          log.push({ what: 'clone', url, path })

          return {
            fetch(remote) {
              log.push({ what: 'fetch', remote })
            }
          }
        },

        Repository: {
          open(path) {
            log.push({ what: 'open', path })
            throw new Error('nope')
          }
        }
      })

      await new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame', url: 'git://repo' }
      )._updateRepository()

      assert.deepEqual(log, [
        { what: 'open', path: `${workingDirectory}/repos/reponame` },
        {
          what: 'clone',
          url: 'git://repo',
          path: `${workingDirectory}/repos/reponame`
        }
      ])
    })
  })

  describe('Build._createWorkspace', function() {
    let workingDirectory

    beforeEach(async function() {
      workingDirectory = await tempDir()
      mockConfig('workingDirectory', workingDirectory)
    })

    it('clones the repo in a temp workspace and checks out the event SHA', async function() {
      let log = []
      mock('Git', {
        Clone(source, dest) {
          log.push({ what: 'clone', source, dest })

          return {
            createBranch(name, sha) {
              log.push({ what: 'create branch', name, sha })
              return 'myref'
            },
            checkoutRef(ref) {
              log.push({ what: 'checkout', ref })
            }
          }
        }
      })

      await new Build(
        'ID',
        { head_commit: { id: 'mysha' } },
        { name: 'reponame' }
      )._createWorkspace()

      let firstLog = log.shift()
      assert.equal(firstLog.what, 'clone')
      assert.equal(firstLog.source, `${workingDirectory}/repos/reponame`)
      assert.include(firstLog.dest, '/peon-workspace-reponame')

      assert.deepEqual(log, [
        { what: 'create branch', name: 'peon-build', sha: 'mysha' },
        { what: 'checkout', ref: 'myref' }
      ])
    })
  })

  describe('Build._readPeonConfig', function() {
    async function readPeonConfig(json, repoConfig) {
      let build = new Build('ID', { head_commit: { id: 'mysha' } }, repoConfig)

      build.start = new Date('2001-02-03T04:05:06Z')
      build.workspace = await tempDir()

      if (json) {
        await writeFile(
          resolve(build.workspace, '.peon.yml'),
          yaml.safeDump(json)
        )
      }

      await build._readPeonConfig()
      return build
    }

    it('fails when .peon.yml is missing', async function() {
      try {
        await readPeonConfig(null, {})
        assert.ok(false)
      } catch(e) {
        assert.equal(e.code, 'ENOENT')
      }
    })

    it('fails when `output` is not a string', async function() {
      for (let output of [null, {}, 1]) {
        try {
          await readPeonConfig({ output }, {})
          assert.ok(false)
        } catch(e) {
          assert.equal(e.message, 'missing output parameter in .peon.yml')
        }
      }
    })

    it('fails when `commands` is not an array with items', async function() {
      for (let commands of [null, 'string', []]) {
        try {
          await readPeonConfig({ output: 'dist', commands }, {})
          assert.ok(false)
        } catch(e) {
          assert.equal(e.message, 'no build commands in .peon.yml')
        }
      }
    })

    it('fails when building a tag and `tags` is not present', async function() {
      try {
        await readPeonConfig(
          { output: 'dist', commands: ['build'] },
          { ref: 'mytag', refMode: 'tag' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(e.message, 'tag mytag is not present in .peon.yml')
      }
    })

    it('fails when building a tag and `tags` has no matching regexp', async function() {
      try {
        await readPeonConfig(
          { output: 'dist', commands: ['build'], tags: ['^v', '^release'] },
          { ref: 'mytag', refMode: 'tag' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(e.message, 'tag mytag is not present in .peon.yml')
      }
    })

    it('fails when building a branch and `branches` is present but has no matching regexp', async function() {
      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build'],
            branches: ['^master$', '^feat/']
          },
          { ref: 'mybranch', refMode: 'branch' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(e.message, 'branch mybranch is not present in .peon.yml')
      }
    })

    it('fails when no destination is specified', async function() {
      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build']
          },
          { ref: 'mybranch', refMode: 'branch' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(
          e.message,
          "could not find a destination matching branch 'mybranch' in .peon.yml"
        )
      }
    })

    it('fails when an unknown destination is specified', async function() {
      mockConfig('destinations', { known: {} })
      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build'],
            destinations: [{ name: 'unknown' }]
          },
          { ref: 'mybranch', refMode: 'branch' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(
          e.message,
          "unknown build destination: 'unknown' in .peon.yml"
        )
      }
    })

    it('fails when building a tag and no matching destination is found', async function() {
      mockConfig('destinations', { dest1: {}, dest2: {}, dest3: {} })
      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build'],
            tags: ['mytag'],
            destinations: [
              { name: 'dest1', tag: '^release' },
              { name: 'dest2', branch: '^master$' },
              { name: 'dest3' }
            ]
          },
          { ref: 'mytag', refMode: 'tag' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(
          e.message,
          "could not find a destination matching tag 'mytag' in .peon.yml"
        )
      }
    })

    it('fails when building a branch and no matching destination is found', async function() {
      mockConfig('destinations', { dest1: {}, dest2: {}, dest3: {} })
      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build'],
            destinations: [
              { name: 'dest1', tag: '^release' },
              { name: 'dest2', branch: '^feat/' },
              { name: 'dest3', tag: '^v', branch: '^chore/' }
            ]
          },
          { ref: 'mybranch', refMode: 'branch' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(
          e.message,
          "could not find a destination matching branch 'mybranch' in .peon.yml"
        )
      }
    })

    it('choses the first matching destination', async function() {
      let dest1 = {}
      let dest2 = { rootUrl: 'root' }
      let dest3 = { rootUrl: 'root' }
      mockConfig('destinations', { dest1, dest2, dest3 })

      let build = await readPeonConfig(
        {
          output: 'dist',
          commands: ['build'],
          destinations: [
            { name: 'dest1', path: 'path1', branch: '^master$' },
            { name: 'dest2', path: 'path2', branch: '^my' },
            { name: 'dest3', path: 'path3', branch: '^m' }
          ]
        },
        { ref: 'mybranch', refMode: 'branch' }
      )

      assert.equal(build.destination, dest2)
      assert.equal(build.pathInDestination, 'path2')

      build = await readPeonConfig(
        {
          output: 'dist',
          commands: ['build'],
          destinations: [
            { name: 'dest1', path: 'path1', branch: '^master$' },
            { name: 'dest2', path: 'path2', tag: '^v' },
            { name: 'dest3' }
          ]
        },
        { ref: 'mybranch', refMode: 'branch' }
      )

      assert.equal(build.destination, dest3)
      assert.equal(build.pathInDestination, '$PEON_REPO_NAME/$PEON_REF')

      build = await readPeonConfig(
        {
          output: 'dist',
          commands: ['build'],
          tags: ['mytag'],
          destinations: [
            { name: 'dest1', path: 'path1' },
            { name: 'dest2', path: 'path2', branch: '^master$', tag: '^my' },
            { name: 'dest3', path: 'path3', tag: '^m' }
          ]
        },
        { ref: 'mytag', refMode: 'tag' }
      )

      assert.equal(build.destination, dest2)
      assert.equal(build.pathInDestination, 'path2')
    })

    it('fails when chosen destination has a relative part', async function() {
      mockConfig('destinations', { dest1: {} })

      try {
        await readPeonConfig(
          {
            output: 'dist',
            commands: ['build'],
            destinations: [{ name: 'dest1', path: '../path' }]
          },
          { ref: 'mybranch', refMode: 'branch' }
        )
        assert.ok(false)
      } catch(e) {
        assert.equal(
          e.message,
          "invalid relative destination path '../path' (resolves to '../path') in .peon.yml"
        )
      }
    })

    it('creates environment with peon variables and config from repo when building a branch', async function() {
      mockConfig('destinations', { dest1: { rootUrl: '/root/url' } })
      let receivedEnv

      mock(
        'Environment',
        class {
          constructor(env) {
            receivedEnv = env
          }
        }
      )

      await readPeonConfig(
        {
          output: 'dist',
          commands: ['build'],
          destinations: [{ name: 'dest1', path: 'path1' }],
          environment: { var1: 'value1', var2: 'value2' }
        },
        { name: 'reponame', ref: 'mybranch', refMode: 'branch' }
      )

      assert.deepEqual(receivedEnv, {
        PEON_BUILD_ID: 'ID',
        PEON_BUILD_DATE: '2001-02-03T04:05:06.000Z',
        PEON_ROOT_URL: '/root/url/path1',
        PEON_REPO_NAME: 'reponame',
        PEON_BRANCH: 'mybranch',
        PEON_TAG: '',
        PEON_REF: 'mybranch',
        PEON_COMMIT: 'mysha',
        var1: 'value1',
        var2: 'value2'
      })
    })

    it('creates environment with peon variables and config from repo when building a tag', async function() {
      mockConfig('destinations', { dest1: { rootUrl: '/root/url' } })
      let receivedEnv

      mock(
        'Environment',
        class {
          constructor(env) {
            receivedEnv = env
          }
        }
      )

      await readPeonConfig(
        {
          output: 'dist',
          commands: ['build'],
          tags: ['mytag'],
          destinations: [{ name: 'dest1', tag: '^my' }],
          environment: { var1: 'value1', var2: 'value2' }
        },
        { name: 'reponame', ref: 'mytag', refMode: 'tag' }
      )

      assert.deepEqual(receivedEnv, {
        PEON_BUILD_ID: 'ID',
        PEON_BUILD_DATE: '2001-02-03T04:05:06.000Z',
        PEON_ROOT_URL: '/root/url/$PEON_REPO_NAME/$PEON_REF',
        PEON_REPO_NAME: 'reponame',
        PEON_BRANCH: '',
        PEON_TAG: 'mytag',
        PEON_REF: 'mytag',
        PEON_COMMIT: 'mysha',
        var1: 'value1',
        var2: 'value2'
      })
    })
  })

  describe('Build._restoreCache', function() {
    it('calls restoreCache and returns restored paths', async function() {
      let build = new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )

      build.peonConfig = { cache: 'cache' }
      build.workspace = 'workspace'

      let restoreCacheArgs
      mock('cache', {
        restoreCache() {
          restoreCacheArgs = [...arguments]
          return ['path1', 'path2']
        }
      })

      let ret = await build._restoreCache()
      assert.deepEqual(restoreCacheArgs, ['reponame', 'workspace', 'cache'])
      assert.equal(ret, 'restored paths path1, path2')
    })

    it('throws a BuildWarning when an error happens', async function() {
      let build = new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )

      build.peonConfig = {}

      mock('cache', {
        restoreCache() {
          throw new Error('oopsie!')
        }
      })

      try {
        await build._restoreCache()
        assert.ok(false)
      } catch(e) {
        assert.instanceOf(e, lookup('BuildWarning'))
        assert.equal(e.message, 'oopsie!')
      }
    })
  })

  describe('Build._saveCache', function() {
    it('calls saveCache and returns saved paths', async function() {
      let build = new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )

      build.peonConfig = { cache: 'cache' }
      build.workspace = 'workspace'

      let saveCacheArgs
      mock('cache', {
        saveCache() {
          saveCacheArgs = [...arguments]
          return ['path1', 'path2']
        }
      })

      let ret = await build._saveCache()
      assert.deepEqual(saveCacheArgs, ['reponame', 'workspace', 'cache'])
      assert.equal(ret, 'saved paths path1, path2')
    })

    it('throws a BuildWarning when an error happens', async function() {
      let build = new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )

      build.peonConfig = {}

      mock('cache', {
        saveCache() {
          throw new Error('oopsie!')
        }
      })

      try {
        await build._saveCache()
        assert.ok(false)
      } catch(e) {
        assert.instanceOf(e, lookup('BuildWarning'))
        assert.equal(e.message, 'oopsie!')
      }
    })
  })

  describe('Build._runCommand', function() {
    it('runs command and reports output', async function() {
      this.slow(300)

      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})
      build.env = new Environment()
      build.workspace = await tempDir()

      let updates = []

      let output = await build._runCommand(
        resolve(root, 'scripts', 'test_command'),
        (out) => updates.push(out)
      )

      assert.deepEqual(output.split('\n'), [
        '[stdout] output line 1',
        '[stdout] output line 2',
        '[stderr] error line',
        '[stdout] output line 3',
        ''
      ])

      assert.deepEqual(updates, [
        '[stdout] output line 1\n',
        '[stdout] output line 1\n[stdout] output line 2\n',
        '[stdout] output line 1\n[stdout] output line 2\n[stderr] error line\n',
        '[stdout] output line 1\n[stdout] output line 2\n[stderr] error line\n[stdout] output line 3\n'
      ])
    })

    it('passes workspace as working directory', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})
      build.env = new Environment({})
      build.workspace = await tempDir()

      let output = await build._runCommand('pwd', () => {})

      assert.deepEqual(output, `[stdout] ${build.workspace}\n`)
    })

    it('passes evaluated environment', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})
      build.env = new Environment({
        VAR1: 'VALUE',
        VAR2: 'EVALUATED/$VAR1'
      })
      build.workspace = await tempDir()

      let output = await build._runCommand('env', () => {})

      let envLines = output.replace(/\[stdout\] /g, '').split('\n')
      assert.include(envLines, 'VAR1=VALUE')
      assert.include(envLines, 'VAR2=EVALUATED/VALUE')
    })

    it('fails when command fails', async function() {
      this.slow(300)

      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})
      build.env = new Environment({})
      build.workspace = await tempDir()

      try {
        await build._runCommand(
          resolve(root, 'scripts', 'test_command fail'),
          () => {}
        )
        assert.ok(false)
      } catch(e) {
        assert.include(e.message, 'exited with error code 1')
      }
    })
  })

  describe('Build._deploy', function() {
    it('fails when output directory is not found', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})

      build.env = new Environment({})
      build.pathInDestination = 'path'
      build.peonConfig = { output: 'missing' }
      build.workspace = await tempDir()

      try {
        await build._deploy()
        assert.ok(false)
      } catch(e) {
        assert.include(e.message, "output directory 'missing' not found")
      }
    })

    it('fails when output is not a directory', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})

      build.env = new Environment({})
      build.pathInDestination = 'path'
      build.peonConfig = { output: 'file' }
      build.workspace = await tempDir()

      await writeFile(resolve(build.workspace, 'file'), 'content')

      try {
        await build._deploy()
        assert.ok(false)
      } catch(e) {
        assert.include(e.message, "output 'file' is not a directory")
      }
    })

    it('deploys locally, creating intermediate directories', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})

      build.env = new Environment({ VAR: 'from_env' })
      build.destination = {
        destination: await tempDir()
      }
      build.pathInDestination = 'path/in/destination/$VAR'
      build.peonConfig = { output: 'output' }
      build.workspace = await tempDir()

      await ensureDir(resolve(build.workspace, 'output'))

      let rsync = { options: [] }
      mock(
        'Rsync',
        class {
          set(option) {
            rsync.options.push(option)
            return this
          }
          source(src) {
            rsync.src = src
            return this
          }
          destination(dst) {
            rsync.dst = dst
            return this
          }
          shell(sh) {
            rsync.sh = sh
            return this
          }
          command() {
            return 'rsync command'
          }
          execute(cb) {
            rsync.executed = true
            cb()
          }
        }
      )

      await build._deploy()

      assert.ok(
        (await stat(
          resolve(build.destination.destination, 'path/in/destination')
        )).isDirectory()
      )

      assert.deepEqual(rsync, {
        options: ['partial', 'recursive', 'compress'],
        src: `${resolve(build.workspace, 'output')}/`,
        dst: `${resolve(
          build.destination.destination,
          'path/in/destination/from_env'
        )}/`,
        executed: true
      })
    })

    it('deploys remotely, moving output to create intermediate directories', async function() {
      let build = new Build(
        'ID',
        { head_commit: { id: 'sha' } },
        { name: 'reponame' }
      )

      build.env = new Environment({ VAR: 'from_env' })
      build.destination = {
        destination: 'user@host:path/to/dest',
        shell: 'someshell'
      }
      build.pathInDestination = 'path/in/destination/$VAR'
      build.peonConfig = { output: 'output' }
      build.workspace = await tempDir()

      await ensureDir(resolve(build.workspace, 'output'))
      await writeFile(resolve(build.workspace, 'output', 'file'), 'content')

      let rsync = { options: [] }
      let outputMoved = false

      mock(
        'Rsync',
        class {
          set(option) {
            rsync.options.push(option)
            return this
          }
          source(src) {
            rsync.src = src
            return this
          }
          destination(dst) {
            rsync.dst = dst
            return this
          }
          shell(sh) {
            rsync.sh = sh
            return this
          }
          command() {
            return 'rsync command'
          }
          execute(cb) {
            rsync.executed = true

            readFile(`${rsync.src}path/in/destination/from_env/file`)
              .then((content) => {
                outputMoved = content.toString() === 'content'
                cb()
              })
              .catch((e) => cb(e))
          }
        }
      )

      await build._deploy()

      assert.ok(outputMoved)

      let { src } = rsync
      assert.ok(src.match(/\/peon-output-reponame-\w+\/$/))

      assert.deepEqual(rsync, {
        options: ['partial', 'recursive', 'compress'],
        src,
        dst: 'user@host:path/to/dest/',
        sh: 'someshell',
        executed: true
      })
    })

    it('fails when rsync throws an error', async function() {
      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})

      build.env = new Environment({})
      build.destination = {
        destination: await tempDir()
      }
      build.pathInDestination = 'path/in/destination'
      build.peonConfig = { output: 'output' }
      build.workspace = await tempDir()

      await ensureDir(resolve(build.workspace, 'output'))

      mock(
        'Rsync',
        class {
          set() {
            return this
          }
          source() {
            return this
          }
          destination() {
            return this
          }
          command() {
            return 'rsync command'
          }
          execute(cb) {
            cb(new Error('oopsie'))
          }
        }
      )

      try {
        await build._deploy()
        assert.ok(false)
      } catch(e) {
        assert.include(e.message, 'oopsie')
      }
    })
  })

  describe('Build.build', function() {
    async function runBuild(peonConfig = {}, fail = false, cancel = false) {
      let log = []

      mock('status', {
        finishBuild() {
          log.push({ what: 'finish', args: [...arguments] })
        }
      })

      let build = new Build('ID', { head_commit: { id: 'sha' } }, {})

      build.env = new Environment({ VAR: 'value' })
      build.destination = { absoluteUrl: 'https://example.com/url' }
      build.peonConfig = peonConfig
      build.pathInDestination = 'path/$VAR'

      build._runStep = function(_, step) {
        log.push({ what: 'step', step: step() })
      }
      build._updateRepository = fail
        ? () => {
          throw new Error('oopsie')
        }
        : () => 'update repository'
      build._createWorkspace = () => 'create workspace'
      build._readPeonConfig = cancel
        ? () => {
          throw new CancelBuild()
        }
        : () => 'read peon config'
      build._restoreCache = () => 'restore cache'
      build._runCommand = (cmd) => `run ${cmd}`
      build._saveCache = () => 'save cache'
      build._deploy = () => 'deploy'

      await build.build()

      return log
    }

    it('runs steps and updates status', async function() {
      let log = await runBuild({ commands: ['cmd1', 'cmd2'], cache: [{}] })

      assert.deepEqual(log, [
        { what: 'step', step: 'update repository' },
        { what: 'step', step: 'create workspace' },
        { what: 'step', step: 'read peon config' },
        { what: 'step', step: 'restore cache' },
        { what: 'step', step: 'run cmd1' },
        { what: 'step', step: 'run cmd2' },
        { what: 'step', step: 'save cache' },
        { what: 'step', step: 'deploy' },
        {
          what: 'finish',
          args: [
            'ID',
            'success',
            { outputURL: 'https://example.com/url/path/value' }
          ]
        }
      ])
    })

    it('does not save/restore cache without cache entries', async function() {
      let log = await runBuild({ commands: ['build'] })

      assert.notOk(log.find((l) => l.step === 'restore cache'))
      assert.notOk(log.find((l) => l.step === 'save cache'))
    })

    it('sets build as failed when a step throws', async function() {
      let log = await runBuild({ commands: ['build'] }, true)

      assert.deepEqual(log.find((l) => l.what === 'finish'), {
        what: 'finish',
        args: ['ID', 'failed']
      })
    })

    it('sets build as cancelled when a step throws a CancelBuild', async function() {
      let log = await runBuild({ commands: ['build'] }, false, true)

      assert.deepEqual(log.find((l) => l.what === 'finish'), {
        what: 'finish',
        args: ['ID', 'cancelled']
      })
    })
  })
})
