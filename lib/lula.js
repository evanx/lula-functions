const assert = require('assert')
const config = require('config')
const Redis = require('ioredis')
const { v4: uuidv4 } = require('uuid')
const { multiAsync, delay } = require('./utils')
const makeMonitor = require('./monitor')

const makeRedisClient = () => {
  if (process.env.TEST_ERR === 'connect-redis') {
    throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
  }
  return new Redis(config.lula.redis.connect)
}

const parseIntStrict = (string) => {
  if (typeof string !== 'string') {
    throw new Error(`parseInt: ${string} with type ${typeof string}`)
  }
  const value = parseInt(string)
  if (string === String(value)) {
    return value
  } else {
    throw new Error(`parseInt: '${string}' to ${value}`)
  }
}

module.exports = async ({ services }) => {
  const serviceInstances = {}
  const redis = makeRedisClient()
  const monitor = makeMonitor({ name: config.lula.logger.name })
  const closeLula = async (value) => {
    try {
      let errorCode = 'unknown'
      if (!value.error) {
        errorCode = 'ok'
      } else {
        errorCode = value.error.code || value.error.message
      }
      const commands = [
        ['srem', 'lula:active:s', String(process.pid)],
        ['zincrby', 'lula:counters:z', 1, 'close'],
        ['zincrby', 'lula:error:counters:z', 1, errorCode],
      ]
      monitor.info({ commands }, 'closeLula')
      await multiAsync(redis, commands)
    } catch (err) {
      monitor.warn({ err }, 'closeLula')
    }
    if (redis) {
      await redis.quit()
    }
  }

  const finish = async (error) => {
    for (let [serviceKey, serviceInstance] of Object.entries(lula)) {
      if (serviceInstance.hooks.finish) {
        monitor.info({ serviceKey }, 'finish')
        try {
          await serviceInstance.hooks.finish(error)
        } catch (err) {
          monitor.warn({ err, serviceKey }, 'finish')
        }
      }
    }
    if (error) {
      await closeLula({
        error: {
          message: error.message,
          code: error.code,
        },
      })
    } else {
      await closeLula({})
    }
  }

  const exit = async (source, err) => {
    if (err) {
      logger.error({ err, source }, 'Exit app')
      await finish(err)
      process.exit(1)
    } else {
      logger.info({ source }, 'Exit app')
      await finish(null)
      process.exit(0)
    }
  }

  const connectServiceInstance = (serviceKey, serviceInstance) => {
    if (process.env.TEST_ERR === `connectServiceInstance:${serviceKey}`) {
      throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
    }

    if (serviceInstance.spec.peers) {
      Object.entries(serviceInstance.spec.peers).map(([peerKey, peerInfo]) => {
        if (peerInfo.serviceKey) {
          const peerInstance = serviceInstances[peerInfo.serviceKey]
          assert(peerInstance, `peer: ${peerInfo.serviceKey}`)
          serviceInstance.lula[peerKey] = peerInstance.hooks
        }
      })
    }
  }

  const setupService = async (serviceConfig, service) => {
    const serviceKey = service.spec.name
    assert(serviceKey, 'service.spec.name')
    if (process.env.TEST_ERR === `setupService:${serviceKey}`) {
      throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
    }

    const serviceInstance = {
      serviceKey,
      spec: service.spec,
      monitor: makeMonitor({
        name: `service:${serviceKey}`,
      }),
      config: Object.assign(service.config, config, serviceConfig),
      counters: {
        loop: 0,
      },
      timers: {
        setup: Date.now(),
      },
      redis: new Redis(config.lula.redis.connect),
      blockingRedis: new Redis(config.lula.redis.connect),
      utils: require('./utils'),
      lula: {},
      exit,
    }

    serviceInstance.parsedConfig = {
      lula: {
        loop: {
          delay: parseIntStrict(serviceInstance.config.lula.loop.delay),
        },
      },
    }

    if (service.spec.peers) {
      Object.entries(service.spec.peers).map(([peerKey, peerInfo]) => {
        if (peerInfo.serviceKey) {
          const peerInstance = serviceInstances[peerInfo.serviceKey]
          if (peerInstance) {
            serviceInstance.lula[peerKey] = peerInstance.hooks
          }
        }
      })
    }

    serviceInstance.hooks = await service.setup(serviceInstance)
    monitor.info(
      {
        serviceKey: serviceInstance.serviceKey,
        hooks: Object.keys(serviceInstance.hooks),
      },
      'setup',
    )
    serviceInstance.runner = async () => {
      if (process.env.TEST_ERR === `start:service:${serviceKey}`) {
        throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
      }
      if (serviceInstance.hooks.start) {
        await serviceInstance.hooks.start()
      }
      while (!serviceInstance.closed && serviceInstance.hooks.loop) {
        if (process.env.TEST_ERR === `loop:service:${serviceKey}`) {
          throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
        }
        serviceInstance.counters.loop++
        await serviceInstance.hooks.loop()
        if (!(await redis.sismember('lula:active:s', String(process.pid)))) {
          throw new Error(`Stopped via Redis key`)
        }
        if (serviceInstance.parsedConfig.lula.loop.delay > 0) {
          await delay(serviceInstance.parsedConfig.lula.loop.delay)
        }
      }
    }

    return serviceInstance
  }

  const [restartCount] = await multiAsync(redis, [
    ['hincrby', 'lula:counter:h', 'restart', 1],
    ['sadd', 'lula:active:s', String(process.pid)],
  ])

  if (config.http && config.http.disabled != 'true') {
    httpServer.listen(parseInt(config.http.port), () => {
      monitor.info(`HTTP server listening on port ${config.http.port}`)
    })
  }

  monitor.info({ restartCount, config, pid: process.pid }, 'lula ready')
  for (const tuple of services) {
    const serviceInstance = await setupService(...tuple)
    serviceInstances[serviceInstance.serviceKey] = serviceInstance
  }
  const serviceKeys = Object.keys(serviceInstances)
  monitor.info({ serviceKeys }, 'Services setup')
  for (const tuple of Object.entries(serviceInstances)) {
    connectServiceInstance(...tuple)
  }
  await Promise.all(
    Object.values(serviceInstances).map((serviceInstance) =>
      serviceInstance.runner(),
    ),
  )
}
