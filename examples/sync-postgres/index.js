const assert = require('assert')

const parseTime = (timeString) => {
  if (/^\d+$/.test(timeString)) {
    return new Date(parseInt(timeString))
  } else {
    return new Date(timeString)
  }
}

const syncItem = async (
  { config, logger, redis, pg, utils },
  { streamKey, syncKey },
  item,
) => {
  assert.strictEqual(item.length, 2, 'syncItem')
  const [itemId, data] = item
  const dataObject = utils.reduceRedisFields(data)
  const time = parseTime(dataObject.time)
  logger.debug({ itemId, dataObject, time }, 'syncItem')
  try {
    await pg.query(
      'insert into lula_sync_stream_' +
        syncKey +
        ' (_id, _ref, _time, _source, _subject, _data) ' +
        'values ($1, $2, $3, $4, $5, $6)',
      [
        itemId,
        dataObject.ref,
        time,
        dataObject.source,
        dataObject.subject,
        dataObject.data,
      ],
    )
  } catch (err) {
    if (err.message.startsWith('duplicate key')) {
      logger.warn({ itemId }, 'Duplicate key')
    } else {
      throw err
    }
  }
  if (process.env.TEST_ERR === 'xack') {
    throw new Error(`TEST_ERR: ${process.env.TEST_ERR}`)
  }
  logger.debug(`xack ${streamKey} ${config.xreadgroup.consumerGroup} ${itemId}`)
  await redis.xack(streamKey, config.xreadgroup.consumerGroup, itemId)
}

module.exports = async (app) => {
  const { config, logger, redis, blockingRedis, pg } = app
  const mutables = {
    counters: {
      loop: 0,
      sync: 0,
      claimed: 0,
    },
  }
  const redisTimeRes = await redis.time()
  const redisTime = parseInt(redisTimeRes[0])
  const streamsRes = await pg.query(
    'select * from lula_sync_stream' +
      ' where _enabled = true' +
      ' and redis_host_key = $1' +
      ' and redis_stream_key = $2',
    [
      config.redis.hostKey,
      config.redis.connect.keyPrefix + config.redis.streamKey,
    ],
  )
  const streamRows = streamsRes.rows
  assert.strictEqual(streamRows.length, 1, 'streamRows.length')
  const { lula_sync_key: syncKey } = streamRows[0]
  const streamKey = config.redis.streamKey
  const streamInfo = { streamKey, syncKey }
  const { consumerGroup } = config.xreadgroup
  const xreadgroupArgs = [
    'group',
    consumerGroup,
    app.instanceId,
    'count',
    config.xreadgroup.count,
    'block',
    config.xreadgroup.block,
    'streams',
    streamKey,
    '>',
  ]
  logger.info({ redisTime, streamKey, consumerGroup, xreadgroupArgs }, 'sync')

  const claimItem = async () => {
    const pendingRes = await redis.xpending(streamKey, consumerGroup)
    if (pendingRes[0]) {
      const timestamp = parseInt(pendingRes[1])
      if (Date.now() - timestamp > config.claim.minIdleTime) {
        const xclaimArgs = [
          streamKey,
          consumerGroup,
          app.instanceId,
          config.claim.minIdleTime,
          pendingRes[1],
        ]
        logger.debug(`xclaim ${xclaimArgs.join(' ')}`)
        const claimRes = await redis.xclaim(...xclaimArgs)
        if (claimRes.length) {
          assert.strictEqual(claimRes.length, 1, 'claimRes.length')
          return claimRes[0]
        }
      }
    }
  }

  return {
    async start() {
      if (process.env.LOOP_LIMIT) {
        mutables.loopLimit = parseInt(process.env.LOOP_LIMIT)
      }
    },
    async end() {
      logger.info('end')
    },
    async loop() {
      logger.debug(mutables.counters, 'loop')
      if (
        !mutables.claimTime ||
        Date.now() - mutables.claimTime > config.claim.interval
      ) {
        mutables.counters.claimed++
        mutables.claimTime = Date.now()
        const claimedEntry = await claimItem()
        if (claimedEntry) {
          logger.info({ claimedEntry }, 'Claimed entry')
          await syncItem(app, streamInfo, claimedEntry)
        }
      }
      if (!config.xreadgroup.disabled) {
        const readRes = await blockingRedis.xreadgroup(...xreadgroupArgs)
        if (readRes) {
          const entry = readRes[0][1][0]
          logger.info({ entry }, 'xreadgroup')
          await syncItem(app, streamInfo, entry)
          mutables.counters.sync++
        }
      }
    },
  }
}
