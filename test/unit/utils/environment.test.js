const { assert } = require('chai')
const { lookup } = require('../../helpers')

const { Environment } = lookup()

describe('unit | utils/environment', function() {
  describe('Environment.evaluate', function() {
    it('returns values passed to ctor', function() {
      assert.equal(new Environment({ foo: 'bar' }).evaluate('$foo'), 'bar')
    })

    it('returns empty values for unknown variables', function() {
      assert.equal(new Environment({}).evaluate('$foo'), '')
    })

    it('matches variables on word boundaries', function() {
      assert.equal(
        new Environment({ foo: 'bar' }).evaluate('ab$foo/$fooo'),
        'abbar/'
      )
    })

    it('evaluates recursively', function() {
      assert.equal(
        new Environment({
          foo: '$bar',
          bar: '$baz',
          baz: 'bing'
        }).evaluate('$foo'),
        'bing'
      )
    })

    it('throws on evaluation loop', function() {
      assert.throws(
        () =>
          new Environment({
            foo: '$bar',
            bar: '$baz',
            baz: '$foo'
          }).evaluate('$foo'),
        'Evaluation loop: foo => bar => baz => foo'
      )
    })
  })

  describe('Environment.evaluateAll', function() {
    it('returns all env', function() {
      assert.deepEqual(
        new Environment({ foo: 'bar', baz: 'bing' }).evaluateAll(),
        { foo: 'bar', baz: 'bing' }
      )
    })

    it('evaluates variables', function() {
      assert.deepEqual(
        new Environment({
          foo: 'bar',
          baz: 'bing',
          var1: '$foo/$baz'
        }).evaluateAll(),
        { foo: 'bar', baz: 'bing', var1: 'bar/bing' }
      )
    })

    it('throws on evaluation loop', function() {
      assert.throws(
        () =>
          new Environment({
            foo: '$bar',
            bar: '$foo',
            var1: '$foo/$baz'
          }).evaluateAll(),
        'Evaluation loop'
      )
    })
  })
})
