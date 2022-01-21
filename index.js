const assert = require('assert');
const debug = require('debug')('jambonz:rtpengines-utils');
const Engine = require('./lib/engine');

const noopLogger = {info: () => {}, error: () => {}};
let engines = [];
let timer;
let idx = 0;
const PING_INTERVAL = process.env.RTPENGINE_PING_INTERVAL ? parseInt(process.env.RTPENGINE_PING_INTERVAL) : 20000;
const myPingInterval = Math.min(60000, Math.max(PING_INTERVAL, 10000));

const _selectEngine = (engines) => {
  const active = engines.filter((c) => c.isActive);
  if (active.length) return active[idx++ % active.length];
};

const _testEngines = (logger, engines, opts) => {
  debug('starting rtpengine pings');
  return setInterval(async() => {
    for (const engine of engines) {
      engine.test(opts.emitter)
        .catch((err) => logger.error({err}, `Error sending statistics to host ${engine.host}`));
    }
  }, opts.pingInterval || myPingInterval);
};

const _setEngines = (logger, arr, opts) => {
  opts = opts || {};
  if (timer) clearInterval(timer);

  /* close sockets of any existing connections */
  engines.forEach((e) => e.destroy());

  /* create new connections, unless we are creating on a per-call basis (transient) */
  engines = arr.map((hp) => {
    const arr = /^(.*):(\d*)$/.exec(hp.trim());
    if (!arr) throw new Error('rtpengine-utils: must provide an array of host:port rtpengines');
    const engine = new Engine(logger, {...opts, host: arr[1], port: parseInt(arr[2])});
    engine.connect();
    return engine;
  });

  if (engines[0].isConnectionLess) {
    /* ping intermittently */
    timer = _testEngines(logger, engines, opts);
  }
};

/**
 * function that returns an object containing a function --
 * that returned function (getRtpEngine) can be called repeatedly
 * to get a set of bound functions (offer, answer, del) that
 * are associated with the rtpengine having fewest calls
 *
 * {Array} arr - an array of host:port of rtpengines and their ng control ports
 * {object} logger - pino logger
 * {object} [opts] - configuration options
 * {string} [opts.protocol] - protocol to use to connect to rtpengine: udp, tcp, or ws (default: udp)
 * {number} [opts.timeout] - length of time in secs to wait for rtpengine to respond to a command
 * {number} [opts.pingInterval] - length of time in secs to ping rtpengines with a 'list' command
 */
module.exports = function(arr, logger, opts = {}) {
  assert.ok(Array.isArray(arr), 'jambonz-rtpengine-utils: missing array of host:port rtpengines');
  logger = logger || noopLogger;

  const getRtpEngine = async() => {
    debug(`selecting rtpengine from array of ${engines.length}`);
    const engine = _selectEngine(engines);
    if (engine) {
      debug({engine}, 'selected engine');
      return engine.getFunctionalInterface();
    }
  };

  const setRtpEngines = (arr) => {
    _setEngines(logger, arr, opts);
  };

  _setEngines(logger, arr, opts);

  return {
    setRtpEngines,
    getRtpEngine
  };
};
