const { src, cleanup } = require('./helpers')
const Peon = require(`${src}/peon`)

Peon.loadModules(true /* test mode */)

afterEach(cleanup)
