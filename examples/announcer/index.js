module.exports = {
  spec: {
    name: 'hello-world',
    link: {
      announcer: {
        stub: 'github.com/evanx/lula-functions/example/announcer',
      },
    },
  },
  config: {},
  setup: async ({ lula, config, monitor, redis }) => {
    monitor.info({
      redisTime: await redis.time(),
    })

    return {
      loop: async () => {
        monitor.info(
          {
            redisTime: await redis.time(),
          },
          'loop',
        )
      },
    }
  },
}
