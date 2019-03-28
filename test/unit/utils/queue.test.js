const { assert } = require('chai')
const { lookup, wait } = require('../../helpers')

const { Queue } = lookup()

describe('unit | utils/queue', function() {
  describe('Queue', function() {
    it('runs async tasks in queue order', async function() {
      this.slow(300)

      let log = []

      function makeTask(id, waitStart) {
        return async function() {
          if (waitStart) {
            await wait(50)
          }

          log.push(`starting task ${id}`)
          await wait(50)
          log.push(`finishing task ${id}`)
        }
      }

      let q = new Queue()
      q.run(makeTask(1, true))
      q.run(makeTask(2))
      q.run(makeTask(3))
      await q.join()

      assert.deepEqual(log, [
        'starting task 1',
        'finishing task 1',
        'starting task 2',
        'finishing task 2',
        'starting task 3',
        'finishing task 3'
      ])
    })
  })
})
