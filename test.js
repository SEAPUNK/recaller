import test from 'ava'
import recaller, {
  constantBackoff,
  exponentialBackoff,
  fullJitterBackoff,
  equalJitterBackoff,
  decorrelatedJitterBackoff
} from './'

test('function should not be retried if async function is ok', async t => {
  t.plan(1)

  let called = false

  const retval = await recaller(async () => {
    if (called) return t.fail('Called multiple times')
    called = true
    return 50
  })

  t.is(retval, 50)
})

test('function should be retried if async function rejects (next ok)', async t => {
  t.plan(1)

  let called = false

  const retval = await recaller(async () => {
    if (!called) {
      called = true
      throw new Error('uh oh')
    }
    return 50
  })

  t.is(retval, 50)
})

test('function should be retried if async function rejects (all fail)', async t => {
  t.plan(1)

  try {
    await recaller(async () => {
      throw new Error('uh oh')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'uh oh')
  }
})

test('bailing should work (error provided)', async t => {
  t.plan(2)

  let called = false
  let bailed = false

  try {
    await recaller(async (bail) => {
      if (bailed) t.fail('bailed, but still called')
      if (called) {
        bailed = true
        bail(new Error('bailed!'))
        t.pass()
        return
      }
      called = true
      throw new Error('uh oh')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'bailed!')
  }
})

test('bailing should work (nothing provided)', async t => {
  t.plan(1)

  try {
    await recaller(async (bail) => {
      bail()
      throw new Error('well')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'Bailed without giving a reason.')
  }
})

test('recaller must require a function', async t => {
  t.plan(1)

  try {
    await recaller()
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fn is not a function')
  }
})

test('retry amounts (default, 10)', async t => {
  t.plan(12)

  try {
    await recaller(async () => {
      t.pass()
      throw new Error('fail')
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('retry amounts (set, 4)', async t => {
  t.plan(6)

  try {
    await recaller(async () => {
      t.pass()
      throw new Error('fail')
    }, {retries: 4})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('attempt should be a correct number', async t => {
  t.plan(5)

  let currentAttempt = 1

  try {
    await recaller(async (bail, attempt) => {
      t.is(attempt, currentAttempt)
      currentAttempt++
      throw new Error('fail')
    }, {retries: 3})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('onretry, invalid value', async t => {
  t.plan(1)

  try {
    await recaller(async () => {
      throw new Error('fail')
    }, {onretry: 123})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'onretry handler is not a function')
  }
})

test('onretry, called (no backoff)', async t => {
  t.plan(31)

  let currentAttempt = 1

  try {
    await recaller(async (bail, attempt) => {
      throw new Error('fail' + attempt)
    }, {onretry: function (err, attempt, delayTime) {
      t.is(err.message, 'fail' + currentAttempt)
      t.is(attempt, currentAttempt)
      t.is(delayTime, 0)
      currentAttempt++
    }})
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'fail11')
  }
})

test('onretry, called (backoff)', async t => {
  t.plan(2)

  try {
    await recaller(async () => {
      throw new Error('fail')
    }, {
      onretry: function (err, attempt, delayTime) {
        err // touch so linter doesn't complain
        t.is(delayTime, 200)
      },
      retries: 1,
      backoff: constantBackoff(200)
    })
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('onretry, error throwing', async t => {
  t.plan(2)

  let thrown = false

  try {
    await recaller(async (bail, attempt) => {
      if (thrown) return bail(new Error('was thrown'))
      if (attempt === 3) {
        throw new TypeError('type error')
      }
      throw new Error('normal error')
    }, {
      onretry: function (err, attempt, delayTime) {
        if (err instanceof TypeError) {
          t.is(thrown, false)
          thrown = true
          throw err
        }
      }
    })
    t.fail('did not throw')
  } catch (err) {
    t.is(err.message, 'type error')
  }
})

test('backoff (constant)', async t => {
  t.plan(2)

  let lastDelay

  try {
    await recaller(async () => {
      if (lastDelay) {
        const duration = Date.now() - lastDelay
        t.is((duration > 200), true)
      }
      lastDelay = Date.now()
      throw new Error('fail')
    }, {
      retries: 1,
      backoff: constantBackoff(200)
    })
  } catch (err) {
    t.is(err.message, 'fail')
  }
})

test('constantBackoff', t => {
  t.plan(4)

  // default values
  const cb1 = constantBackoff()
  t.is(cb1(1), 5000)
  t.is(cb1(2), 5000)

  // custom ms
  const cb2 = constantBackoff(300)
  t.is(cb2(1), 300)
  t.is(cb2(2), 300)
})

test('exponentialBackoff', t => {
  t.plan(12)

  // default values
  const eb1 = exponentialBackoff()
  t.is(eb1(1), 1000)
  t.is(eb1(2), 2000)
  t.is(eb1(3), 4000)

  // custom base
  const eb2 = exponentialBackoff({base: 500})
  t.is(eb2(1), 500)
  t.is(eb2(2), 1000)
  t.is(eb2(3), 2000)

  // custom cap
  const eb3 = exponentialBackoff({cap: 3000})
  t.is(eb3(1), 1000)
  t.is(eb3(2), 2000)
  t.is(eb3(3), 3000)

  // custom factor
  const eb4 = exponentialBackoff({factor: 1})
  t.is(eb4(1), 1000)
  t.is(eb4(2), 1000)
  t.is(eb4(3), 1000)
})

test('fullJitterBackoff', t => {
  t.plan(6 * 10000)

  // default values
  const fjb1 = fullJitterBackoff()

  for (let i = 0; i < 10000; i++) {
    const val = fjb1(1)
    t.is((
      val <= 1000 &&
      val >= 0
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = fjb1(2)
    t.is((
      val <= 2000 &&
      val >= 0
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = fjb1(3)
    t.is((
      val <= 4000 &&
      val >= 0
    ), true)
  }

  // custom values
  const fjb2 = fullJitterBackoff({cap: 2000, base: 500})

  for (let i = 0; i < 10000; i++) {
    const val = fjb2(1)
    t.is((
      val <= 500 &&
      val >= 0
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = fjb2(2)
    t.is((
      val <= 1000 &&
      val >= 0
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = fjb2(1)
    t.is((
      val <= 2000 &&
      val >= 0
    ), true)
  }
})

test('equalJitterBackoff', t => {
  t.plan(6 * 10000)

  // default values
  const ejb1 = equalJitterBackoff()

  for (let i = 0; i < 10000; i++) {
    const val = ejb1(1)
    t.is((
      val <= 1000 &&
      val >= 500
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = ejb1(2)
    t.is((
      val <= 2000 &&
      val >= 1000
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = ejb1(3)
    t.is((
      val <= 4000 &&
      val >= 2000
    ), true)
  }

  // custom values
  const ejb2 = equalJitterBackoff({cap: 2000, base: 500})

  for (let i = 0; i < 10000; i++) {
    const val = ejb2(1)
    t.is((
      val <= 500 &&
      val >= 250
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = ejb2(2)
    t.is((
      val <= 1000 &&
      val >= 500
    ), true)
  }

  for (let i = 0; i < 10000; i++) {
    const val = ejb2(3)
    t.is((
      val <= 2000 &&
      val >= 1000
    ), true)
  }
})

test('decorrelatedJitterBackoff', t => {
  t.plan(4 * 10000)

  // Default options, first value
  for (let i = 0; i < 10000; i++) {
    const gen = decorrelatedJitterBackoff()
    const val = gen()
    t.is((
      val >= 1000 &&
      val <= 3000
    ), true)
  }

  // Default options, second value
  for (let i = 0; i < 10000; i++) {
    const gen = decorrelatedJitterBackoff()
    gen() // generate first
    const val = gen()
    t.is((
      val >= 1000 &&
      val <= 9000
    ), true)
  }

  // Capped (otherwise default), third value
  for (let i = 0; i < 10000; i++) {
    const gen = decorrelatedJitterBackoff({cap: 24000})
    gen() // generate first
    gen() // generate second
    const val = gen()
    t.is((
      val >= 1000 &&
      val <= 24000
    ), true)
  }

  // times 4, first value
  for (let i = 0; i < 10000; i++) {
    const gen = decorrelatedJitterBackoff({times: 4})
    const val = gen()
    t.is((
      val >= 1000 &&
      val <= 4000
    ), true)
  }
})
