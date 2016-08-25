'use strict'

const copromise = require('mini-copromise')
const delay = require('delay')

// Gets a number between min (inclusive) and max (inclusive)
function randomBetween (min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

// Main recaller function.
// fn: Function to retry.
//
//     Function is called with 2 arguments:
//     - bail: A function that stops the retry operation, and rejects
//             the retrier promise with a given error instance.
//     - attempt: Current attempt. First attempt is attempt 1.
//
// opts: Options object.
//
// opts.retries: How many times to retry before giving up.
//               If retry is 1, then the function will be called twice total
//               before giving up.
//               Defaults to 10 retries.
//
// opts.backoff: Function that returns the next backoff delay on call.
//               Recaller comes with a few standard backoff functions,
//               see below.
//
//               Function is called with 1 argument:
//               - attempt: Current attempt.
//
// opts.onretry: Function that gets called when the function has thrown,
//               and we will retry (potentially after waiting).
//               You can also prevent a retry by having the onretry function
//               throw, if you want to prevent retries under certain conditions.
//
//               Function is called with 3 arguments:
//               - err: Error thrown by the current attempt
//               - attempt: Which attempt that was.
//               - delayTime: How long we will wait in ms before trying again
//                            (0 if we are not waiting)
function recaller (fn, opts) {
  return new Promise((resolve, reject) => {
    if (typeof fn !== 'function') throw new Error('fn is not a function')
    opts = opts || {}
    if (opts.onretry && typeof opts.onretry !== 'function') throw new Error('onretry handler is not a function')

    const retries = opts.retries || 10

    let bailed = false
    let attempt = 0

    function bail (err) {
      bailed = true
      return reject(err || new Error('Bailed without giving a reason.'))
    }

    const runner = copromise(function * () {
      const backoff = opts.backoff
      while (true) {
        try {
          attempt++
          return yield fn(bail, attempt)
        } catch (err) {
          if (bailed) return
          let delayTime = 0
          if (backoff) {
            delayTime = backoff(attempt)
          }
          if (attempt > retries) {
            throw err
          } else {
            if (opts.onretry) opts.onretry(err, attempt, delayTime)
            if (delayTime) yield delay(delayTime)
            continue
          }
        }
      }
    })

    runner().then(resolve).catch(reject)
  })
}

// Backoff generator functions
// These are functions that you can conveniently use when setting the backoff
// options for the retrier.

// Constant backoff delay generator. Consistently waits for "ms" milliseconds
// before trying again.
//
// ms: (default 5) Delay in ms.
function constantBackoff (ms) {
  ms = ms || 5000
  return () => ms
}

// Below functions use algorithms and formulas taken from:
// https://www.awsarchitectureblog.com/2015/03/backoff.html
// https://github.com/awslabs/aws-arch-backoff-simulator

// Exponential backoff delay generator.
//
// opts: options object
// opts.base: (default 1000) Base delay in ms to calculate the next delay with
//            The first attempt will be the base delay.
//            For example, if the base is 1000 (1s) and factor is 2, then the
//            delays will go in this order: 1s, 2s, 4s, 8s, etc.
// opts.cap: (default 60000) Max allowed delay in ms.
// opts.factor: (default 2) Exponential factor.
function exponentialBackoff (opts) {
  opts = opts || {}
  const base = opts.base || 1000
  const cap = opts.cap || 60000
  const factor = opts.factor || 2

  return (attempt) => Math.min(cap, (
    base * Math.pow(
      factor, (attempt - 1)
    )
  ))
}

// Exponential backoff generator, with full jitter.
// It's more-or-less the same as the exponential backoff generator, except
// the delay returned will be between 0 and the generated delay.
//
// opts: options object
// opts.base: see exponentialBackoff(opts.base)
// opts.cap: see exponentialBackoff(opts.cap)
// opts.factor: see exponentialBackoff(opts.factor)
function fullJitterBackoff (opts) {
  const gen = exponentialBackoff(opts)
  return (attempt) => randomBetween(0, gen(attempt))
}

// Exponential backoff generator, with equal jitter.
// See https://www.awsarchitectureblog.com/2015/03/backoff.html's
// explanation of "equal jitter" for more information.
//
// opts: options object
// opts.base: see exponentialBackoff(opts.base)
// opts.cap: see exponentialBackoff(opts.cap)
// opts.factor: see exponentialBackoff(opts.factor)
function equalJitterBackoff (opts) {
  const gen = exponentialBackoff(opts)
  return (attempt) => {
    const halfDelay = gen(attempt) / 2
    return halfDelay + randomBetween(0, halfDelay)
  }
}

// Exponential(?) backoff generator, with decorrelated jitter.
// See https://www.awsarchitectureblog.com/2015/03/backoff.html's
// explanation of "decorrelated jitter" for more information.
//
// Note that this generator is stateful, which means that if you reuse it, it
// might not behave as you would expect.
//
// opts: options object
// opts.base: (default 5000) Base delay in ms. Used as initial delay, and
//            to calculate future values.
// opts.cap: (default 60000) Delay in ms to not go above
// opts.times: (default 3) See code below.
function decorrelatedJitterBackoff (opts) {
  opts = opts || {}
  const base = opts.base || 1000
  const cap = opts.cap || 60000
  const times = opts.times || 3

  let lastSleep = base
  return () => {
    const sleep = Math.min(cap, randomBetween(base, lastSleep * times))
    lastSleep = sleep
    return sleep
  }
}

module.exports = recaller
module.exports.constantBackoff = constantBackoff
module.exports.exponentialBackoff = exponentialBackoff
module.exports.fullJitterBackoff = fullJitterBackoff
module.exports.equalJitterBackoff = equalJitterBackoff
module.exports.decorrelatedJitterBackoff = decorrelatedJitterBackoff
