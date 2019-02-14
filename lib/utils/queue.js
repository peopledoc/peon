class Queue {
  constructor() {
    this.promise = Promise.resolve()
  }

  run(asyncjob) {
    this.promise = this.promise.then(asyncjob)
  }

  async join() {
    await this.promise
  }
}

module.exports = Queue
