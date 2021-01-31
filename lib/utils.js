const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const multiAsync = async (redis, commands, hook) => {
  const results = await redis.multi(commands).exec()
  const err = results.find(([err]) => err)
  if (err) {
    throw new Error(err)
  }
  const res = results.map(([, res]) => res)
  if (hook) {
    hook({ commands, res })
  }
  return res
}

const reduceRedisFields = (fields) => {
  const object = {}
  for (let i = 0; i < fields.length; i += 2) {
    object[fields[i]] = fields[i + 1]
  }
  return object
}

module.exports = {
  delay,
  multiAsync,
  reduceRedisFields,
}
