const { mkdtemp, remove } = require('fs-extra')
const { dirname, resolve } = require('path')
const { tmpdir } = require('os')

const root = dirname(__dirname)
const src = resolve(root, 'lib')
const { lookup, register } = require(`${src}/injections`)

const pendingCleanup = []

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = {
  // Paths to peon sources
  root,
  src,

  // Mock configuration values (requires a cleanup call)
  mockConfig(key, value) {
    let config = lookup('config')

    let hasKey = key in config
    let oldValue = config[key]

    config[key] = value

    pendingCleanup.push(() => {
      if (!hasKey) {
        delete config[key]
      } else {
        config[key] = oldValue
      }
    })
  },

  // Mock injectable modules (requires a cleanup call)
  mock(name, value) {
    let oldValue = lookup(name)
    register(name, value)

    pendingCleanup.push(() => {
      register(name, oldValue)
    })
  },

  // Lookup injectable modules
  lookup,

  // Create temp directories (requires a cleanup call)
  async tempDir() {
    let dir = await mkdtemp(resolve(tmpdir(), 'peon-test-'))
    pendingCleanup.push(async() => {
      await remove(dir)
    })
    return dir
  },

  // Restore initial state, calls cleanup function in reverse order
  async cleanup() {
    while (pendingCleanup.length) {
      await pendingCleanup.pop()()
    }

    let { db } = lookup()
    db.close()
  },

  // Return a promise that resolves in ms milliseconds
  wait,

  async waitUntil(predicate, timeout = 1000)  {
    let start = Date.now()
    while (!predicate()) {
      if (Date.now() > start + timeout) {
        throw new Error('waitUntil timed out')
      }

      await wait(10)
    }
  }
}
