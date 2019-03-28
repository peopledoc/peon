const { assert } = require('chai')
const { src } = require('../helpers')
const { register, registerLazy, lookup } = require(`${src}/injections`)

describe('unit | injections', function() {
  it('registers modules', function() {
    register('foo', 'bar')

    assert.equal(lookup('foo'), 'bar')
  })

  it('overrides registered modules', function() {
    register('foo', 'bar')
    register('foo', 'baz')

    assert.equal(lookup('foo'), 'baz')
  })

  it('registers constructors', function() {
    class Foo {}
    register(Foo)
    assert.equal(lookup('Foo'), Foo)
  })

  it('lookups with shorthand syntax', function() {
    class Foo {}
    register(Foo)
    register('foo', 'bar')

    let { foo, Foo: Foo2 } = lookup()
    assert.equal(Foo2, Foo)
    assert.equal(foo, 'bar')
  })

  it('registers with lazy getter', function() {
    let called = 0
    registerLazy('foo', () => {
      called++
      return 'bar'
    })

    assert.equal(called, 0)
    assert.equal(lookup('foo'), 'bar')
    let { foo } = lookup()
    assert.equal(foo, 'bar')
    lookup('foo')
    assert.equal(called, 1)
  })

  it('overrides lazy registered modules', function() {
    let called1 = 0
    registerLazy('foo', () => {
      called1++
      return 'bar'
    })

    lookup('foo')

    let called2 = 0
    registerLazy('foo', () => {
      called2++
      return 'baz'
    })

    assert.equal(lookup('foo'), 'baz')
    assert.equal(called1, 1)
    assert.equal(called2, 1)
  })
})
