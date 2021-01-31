module.exports = {
  spec: {
    name: 'hello-wide-world',
    peers: {
      announcer: {
        stub: 'github.com/evanx/lula-functions/example/announcer',
      },
      helloWorld: {
        serviceKey: 'hello-world',
      },
    },
  },
  config: {},
  setup: async ({ lula, config, monitor, redis }) => {
    monitor.info(
      {
        redisTime: await redis.time(),
        helloWorldAudience: await lula.helloWorld.getAudienceLabel(),
      },
      `hello ${config.audienceLabel}`,
    )

    return {
      loop: async () => {
        monitor.info(
          {
            redisTime: await redis.time(),
          },
          `loop, ${config.audienceLabel}`,
        )
      },
    }
  },
}
