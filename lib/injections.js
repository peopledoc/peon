/*
  Dependency injection utilities for peon

  Call register('name', value) or register(Class) to register modules for
  injection.

  Call registerLazy('name', initializer) to register modules with a lazy
  initializer.

  Call lookup('name') or const { name, ... } = lookup() to get modules.
 */

const registry = {}
const lazies = {}

function registerLazy(key, initializer) {
  delete lazies[key]

  registry.__defineGetter__(key, function() {
    if (!lazies[key]) {
      lazies[key] = initializer()
    }

    return lazies[key]
  })
}

function register(key, value) {
  // Allow shorthand registering of ctors
  if (typeof key === 'function') {
    value = key
    key = value.name
  }

  registerLazy(key, () => value)
}

function lookup(key) {
  return key ? registry[key] : registry
}

module.exports = { register, registerLazy, lookup }
