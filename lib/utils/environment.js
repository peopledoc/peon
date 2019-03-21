const { register } = require('../injections')

class Environment {
  constructor(env = {}) {
    this.env = env
  }

  evaluate(value, path = []) {
    return value.replace(/\$(\w+)/g, (match, variable) => {
      if (path.indexOf(variable) !== -1) {
        throw new Error(`Evaluation loop: ${path.join(' => ')} => ${variable}`)
      }

      return this.evaluate(this.env[variable] || '', path.concat([variable]))
    })
  }

  evaluateAll() {
    return Object.keys(this.env).reduce((env, key) => {
      env[key] = this.evaluate(this.env[key])
      return env
    }, {})
  }
}

register(Environment)
